// Crash-Diagnose: Ergebnis von `crash_analyze` mit Schuldigem, Klartext und Aktionen.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Download, FileWarning, MemoryStick, PowerOff, Stethoscope, UploadCloud } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { qk, waitForTask } from "@/lib/queries";
import type { Diagnosis, DiagnosisAction, Instance, LoaderKind } from "@/lib/types";
import { Button, Dialog, Skeleton, cn, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { uploadCrash } from "./LogsTab";

export function useDiagnosis(instanceId: string, crashReport: string | null, exitCode: number | null, enabled = true) {
  return useQuery({
    queryKey: ["diagnose", instanceId, crashReport, exitCode],
    queryFn: () => api.crashAnalyze(instanceId, crashReport, exitCode),
    enabled,
    staleTime: 60_000,
  });
}

const KNOWN = [
  "missing_dependency",
  "wrong_minecraft",
  "mixin",
  "java_version",
  "out_of_memory",
  "heap_reserve",
  "duplicate_mod",
  "graphics",
  "suspected_mod",
  "exit_code",
];

/** Klartext-Titel/Erklärung einer Diagnose. */
export function diagText(d: Diagnosis, t: (k: string, v?: Record<string, string | number>) => string) {
  const id = KNOWN.includes(d.id) ? d.id : "exit_code";
  const mod = d.culprit?.name || d.culprit?.mod_id || t("diag.some_mod");
  const vars = { mod, ...d.params };
  let text = t(`diag.${id}.text`, vars);
  if (id === "exit_code") text = t(`diag.exit.${d.params.hint ?? "exit_code"}`, vars);
  return { title: t(`diag.${id}.title`, vars), text };
}

async function resolveDependency(inst: Instance, modId: string, name: string | null): Promise<{ id: string; title: string } | null> {
  try {
    const p = await api.contentProject("modrinth", modId);
    return { id: p.id, title: p.title };
  } catch {
    /* kein Slug – suchen */
  }
  const r = await api.contentSearch({
    source: "modrinth",
    query: name ?? modId,
    project_type: "mod",
    game_version: inst.mc_version,
    loader: inst.loader.kind === "vanilla" ? null : (inst.loader.kind as LoaderKind),
    categories: [],
    sort: "relevance",
    offset: 0,
    limit: 5,
  });
  const hit = r.hits.find((h) => h.slug === modId) ?? r.hits[0];
  return hit ? { id: hit.id, title: hit.title } : null;
}

async function runAction(a: DiagnosisAction, inst: Instance, crashReport: string | null) {
  switch (a.kind) {
    case "disable_mod":
      await api.contentSetEnabled(inst.id, "mod", a.file, false);
      toast.success(tt("diag.done.disabled"), a.file);
      return;
    case "install_dependency": {
      const p = await resolveDependency(inst, a.mod_id, a.name);
      if (!p) throw new Error(tt("diag.err.not_found", { mod: a.name ?? a.mod_id }));
      await api.contentInstall(inst.id, "modrinth", p.id, null);
      toast.info(tt("diag.done.installing"), p.title);
      return;
    }
    case "set_java": {
      let list = await api.javaList();
      let j = list.find((x) => x.major === a.major);
      if (!j) {
        toast.info(tt("diag.done.java_download", { major: a.major }));
        await waitForTask(await api.javaInstall(a.major));
        list = await api.javaList();
        j = list.find((x) => x.major === a.major);
      }
      if (!j) throw new Error(tt("diag.err.java", { major: a.major }));
      await api.instanceUpdate(inst.id, { java: { ...inst.java, path: j.path } });
      toast.success(tt("diag.done.java", { major: a.major }), j.path);
      return;
    }
    case "increase_ram":
      await api.instanceUpdate(inst.id, {
        java: { ...inst.java, max_memory_mb: a.suggest_mb, min_memory_mb: Math.min(inst.java.min_memory_mb ?? 512, a.suggest_mb) },
      });
      toast.success(tt("diag.done.ram", { mb: a.suggest_mb }));
      return;
    case "upload":
      await uploadCrash(inst.id, crashReport);
      return;
    case "update_drivers":
      return;
  }
}

function ActionButton({ a, inst, crashReport, onDone }: { a: DiagnosisAction; inst: Instance; crashReport: string | null; onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (a.kind === "update_drivers") return null;
  const label =
    a.kind === "disable_mod"
      ? t("diag.act.disable")
      : a.kind === "install_dependency"
        ? t("diag.act.install", { mod: a.name ?? a.mod_id })
        : a.kind === "set_java"
          ? t("diag.act.java", { major: a.major })
          : a.kind === "increase_ram"
            ? t("diag.act.ram", { gb: Math.round(a.suggest_mb / 1024) })
            : t("logs.upload");
  const icon =
    a.kind === "disable_mod" ? (
      <PowerOff size={13} />
    ) : a.kind === "install_dependency" ? (
      <Download size={13} />
    ) : a.kind === "set_java" ? (
      <Cpu size={13} />
    ) : a.kind === "increase_ram" ? (
      <MemoryStick size={13} />
    ) : (
      <UploadCloud size={13} />
    );
  return (
    <Button
      size="sm"
      variant={a.kind === "upload" ? "ghost" : "accent"}
      icon={icon}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await runAction(a, inst, crashReport);
          if (a.kind !== "upload") onDone();
        } catch (e) {
          toast.error(errorMessage(e), t("diag.err.action"));
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

export function DiagnosisCard({ d, inst, crashReport, compact }: { d: Diagnosis; inst: Instance; crashReport: string | null; compact?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { title, text } = diagText(d, t);
  const onDone = () => {
    qc.invalidateQueries({ queryKey: ["diagnose", inst.id] });
    qc.invalidateQueries({ queryKey: qk.content(inst.id, "mod") });
  };
  return (
    <div className={cn("flex flex-col gap-2", !compact && "border border-line bg-surface p-3.5")}>
      <div className="flex items-start gap-2.5">
        <FileWarning size={16} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-white">{title}</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{text}</p>
          {d.culprit?.file && (
            <div className="mt-1.5 inline-flex max-w-full items-center gap-1.5 border border-line bg-black/30 px-2 py-0.5 text-[12px]">
              <span className="text-dim">{t("diag.file")}</span>
              <span className="truncate font-mono text-text">{d.culprit.file}</span>
            </div>
          )}
          {!compact && d.evidence && (
            <pre className="selectable mt-2 overflow-hidden text-ellipsis whitespace-pre-wrap break-all font-mono text-[11px] text-dim">{d.evidence}</pre>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-[26px]">
        {d.actions.map((a, n) => (
          <ActionButton key={n} a={a} inst={inst} crashReport={crashReport} onDone={onDone} />
        ))}
      </div>
    </div>
  );
}

/** Dialog mit allen Diagnosen (Logs-Tab, „Details“ im Crash-Banner). */
export function DiagnosisDialog({
  inst,
  crashReport,
  exitCode,
  open,
  onOpenChange,
}: {
  inst: Instance;
  crashReport: string | null;
  exitCode: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useT();
  const q = useDiagnosis(inst.id, crashReport, exitCode, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("diag.title")} description={t("diag.desc")} size="lg">
      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : q.isError ? (
        <p className="text-[13px] text-danger">{errorMessage(q.error)}</p>
      ) : !q.data?.length ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Stethoscope size={28} className="text-dim" />
          <div className="text-[15px] font-semibold text-white">{t("diag.none.title")}</div>
          <p className="max-w-[440px] text-[13px] text-muted">{t("diag.none.text")}</p>
          <Button size="sm" className="mt-2" icon={<UploadCloud size={13} />} onClick={() => uploadCrash(inst.id, crashReport)}>
            {t("logs.upload")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {q.data.map((d, n) => (
            <DiagnosisCard key={n} d={d} inst={inst} crashReport={crashReport} />
          ))}
        </div>
      )}
    </Dialog>
  );
}
