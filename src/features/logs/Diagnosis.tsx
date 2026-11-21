// Crash-Diagnose: Ergebnis von `crash_analyze` mit Schuldigem, Klartext und Aktionen.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Download, FileWarning, MapPin, MemoryStick, Power, PowerOff, UploadCloud, Wrench } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { qk, waitForTask } from "@/lib/queries";
import type { Diagnosis, DiagnosisAction, Instance, LoaderKind } from "@/lib/types";
import { Button, Dialog, Skeleton, cn, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { uploadCrash } from "./LogsTab";
import { openAutofix } from "@/features/content/autofixStore";
import { DriverHelp } from "@/features/perf/DriverHelp";
import { PixelIcon } from "@/components/ui/pixel/PixelIcon";

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
  "outdated_dependency",
  "wrong_minecraft",
  "wrong_loader",
  "loader_version",
  "mixin",
  "mixin_conflict",
  "mod_conflict",
  "known_conflict",
  "broken_config",
  "java_version",
  "out_of_memory",
  "heap_reserve",
  "native_memory",
  "disk_full",
  "invalid_jvm_flag",
  "corrupt_archive",
  "locked_world",
  "duplicate_mod",
  "graphics",
  "suspected_mod",
  "exit_code",
];

/** Versionsbereich aus dem Log („15.0.140 or later“, „>=0.16.10“) in der UI-Sprache. */
export function localRange(range: string | undefined, t: (k: string, v?: Record<string, string | number>) => string): string {
  const r = (range ?? "").trim();
  const m = r.match(/^(?:>=?\s*)?(\S+?)\s+or\s+(?:later|above|newer|higher)$/i) ?? r.match(/^>=?\s*(\S+)$/);
  return m ? t("diag.range.min", { v: m[1] }) : r;
}

/** Klartext-Titel/Erklärung einer Diagnose. */
export function diagText(d: Diagnosis, t: (k: string, v?: Record<string, string | number>) => string) {
  const id = KNOWN.includes(d.id) ? d.id : "exit_code";
  const mod = d.culprit?.name || d.culprit?.mod_id || d.culprit?.file || t("diag.some_mod");
  const other = d.params.other_name || d.params.other_id || d.params.other_file?.replace(/\.jar$/, "") || t("diag.some_mod");
  const vars = { mod, other, present: "?", ...d.params, range: localRange(d.params.range, t), required: localRange(d.params.required, t) };
  // Abhängigkeit ist da, nur deaktiviert
  const off = id === "missing_dependency" && !!d.params.disabled_file;
  let key = off ? "diag.missing_dependency.text_disabled" : `diag.${id}.text`;
  // Andere Richtung: zu neue Java-Version bzw. die anfragende Mod ist zu alt
  if ((id === "java_version" || id === "outdated_dependency") && d.params.direction === "older") key = `diag.${id}.text_older`;
  if (id === "out_of_memory" && d.params.limit) key = "diag.out_of_memory.text_limit";
  let text = t(key, vars);
  if (id === "exit_code") text = t(`diag.exit.${d.params.hint ?? "exit_code"}`, vars);
  return { title: t(off ? "diag.missing_dependency.title_disabled" : `diag.${id}.title`, vars), text };
}

/** Fundstelle „logs/latest.log, Zeile 12“ (ohne Datei: null). */
export function diagWhere(d: Diagnosis, t: (k: string, v?: Record<string, string | number>) => string): string | null {
  if (!d.source) return null;
  const source = d.source === "console" ? t("logs.live") : d.source;
  return d.line ? t("diag.where", { source, line: d.line }) : source;
}

/** Fundstelle mit der gefundenen Zeile. */
export function Evidence({ d, className }: { d: Diagnosis; className?: string }) {
  const t = useT();
  const where = diagWhere(d, t);
  if (!d.evidence && !where) return null;
  return (
    <div className={cn("mt-2 flex flex-col gap-1", className)}>
      {where && (
        <span className="inline-flex items-center gap-1 text-[11.5px] text-dim">
          <MapPin size={11} className="shrink-0" />
          <span className="truncate">{where}</span>
        </span>
      )}
      {d.evidence && (
        <pre className="selectable overflow-hidden text-ellipsis whitespace-pre-wrap break-all rounded-xs bg-black/20 px-2 py-1 font-mono text-[11px] leading-snug text-muted">{d.evidence}</pre>
      )}
    </div>
  );
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
    case "enable_mod":
      await api.contentSetEnabled(inst.id, "mod", a.file, true);
      toast.success(tt("diag.done.enabled"), a.name ?? a.file);
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
    case "update_mod":
    case "reset_config":
      // Tauschen/Zurücksetzen nur über „Probleme beheben“ (Vorschau, Sicherung, Rückgängig)
      openAutofix({ instanceId: inst.id, crashReport });
      return;
    case "update_drivers":
      return;
  }
}

function ActionButton({ a, inst, crashReport, onDone }: { a: DiagnosisAction; inst: Instance; crashReport: string | null; onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (a.kind === "update_drivers") return <DriverHelp />;
  const label =
    a.kind === "disable_mod"
      ? t("diag.act.disable")
      : a.kind === "enable_mod"
        ? t("diag.act.enable", { mod: a.name ?? a.file.replace(/\.jar\.disabled$/, "") })
        : a.kind === "install_dependency"
        ? t("diag.act.install", { mod: a.name ?? a.mod_id })
        : a.kind === "update_mod" || a.kind === "reset_config"
        ? t("diag.act.fix")
        : a.kind === "set_java"
          ? t("diag.act.java", { major: a.major })
          : a.kind === "increase_ram"
            ? t("diag.act.ram", { gb: Math.round(a.suggest_mb / 1024) })
            : t("logs.upload");
  const icon =
    a.kind === "disable_mod" ? (
      <PowerOff size={13} />
    ) : a.kind === "enable_mod" ? (
      <Power size={13} />
    ) : a.kind === "install_dependency" ? (
      <Download size={13} />
    ) : a.kind === "set_java" ? (
      <Cpu size={13} />
    ) : a.kind === "increase_ram" ? (
      <MemoryStick size={13} />
    ) : a.kind === "update_mod" || a.kind === "reset_config" ? (
      <Wrench size={13} />
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
          if (a.kind !== "upload" && a.kind !== "update_mod" && a.kind !== "reset_config") onDone();
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
    <div className={cn("flex flex-col gap-2", !compact && "rounded-card bg-surface p-3.5")}>
      <div className="flex items-start gap-2.5">
        <FileWarning size={16} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-text">{title}</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{text}</p>
          {d.culprit?.file && (
            <div className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-xs bg-white/[.05] px-2 py-0.5 text-[12px]">
              <span className="text-dim">{t("diag.file")}</span>
              <span className="truncate font-mono text-text">{d.culprit.file}</span>
            </div>
          )}
          {!compact && <Evidence d={d} />}
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
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("diag.title")}
      description={t("diag.desc")}
      size="lg"
      footer={
        inst.loader.kind !== "vanilla" || (q.data?.length ?? 0) > 0 ? (
          <Button
            variant="accent"
            icon={<Wrench size={14} />}
            onClick={() => {
              onOpenChange(false);
              openAutofix({ instanceId: inst.id, crashReport, exitCode });
            }}
          >
            {t("fix.button")}
          </Button>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : q.isError ? (
        <p className="text-[13px] text-danger">{errorMessage(q.error)}</p>
      ) : !q.data?.length ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <PixelIcon name="shield" className="text-muted" />
          <div className="text-[15px] font-semibold text-text">{t("diag.none.title")}</div>
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
