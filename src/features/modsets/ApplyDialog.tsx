// OWNER: Content-Agent. Mod-Set(s) auf eine Instanz anwenden: Vorschau (neu / schon da / nicht verfügbar mit Grund
// und Alternativen / Konflikte), dann Installation als Aufgabe mit Fortschritt im selben Dialog.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, ChevronDown, CircleSlash, Download, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { Button, Checkbox, Dialog, ErrorState, Progress, Skeleton, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { loaderNames } from "@/lib/format";
import { queryClient, useInstances, useTask } from "@/lib/queries";
import { invalidateSets, setsApi, useSets, type Pick, type PreviewItem } from "./api";
import { reasonText } from "./shared";

/** Auswahl je Eintrag: "main" = das Projekt selbst, Zahl = Index der Alternative, null = nicht installieren */
type Choice = "main" | number | null;
// Klick auf die Checkbox wird von der Zeile behandelt (sonst doppelt umgeschaltet)
const noop = () => {};

function initialChoice(it: PreviewItem): Choice {
  if (it.status === "install") return "main";
  if (it.status === "unavailable") {
    const i = it.alternatives.findIndex((a) => a.recommended);
    return i >= 0 ? i : null;
  }
  return null;
}

function Row({ icon, title, meta, right, children, dim, onClick }: { icon: ReactNode; title: ReactNode; meta?: ReactNode; right?: ReactNode; children?: ReactNode; dim?: boolean; onClick?: () => void }) {
  return (
    <div className={cn("rounded-card border border-line bg-surface px-3 py-2.5", onClick && "cursor-pointer hover:bg-surface2")} onClick={onClick}>
      <div className="flex items-center gap-3">
        {icon}
        <div className={cn("min-w-0 flex-1", dim && "opacity-70")}>
          <div className="break-words text-[15px] font-semibold text-text">{title}</div>
          {meta && <div className="text-[13px] text-muted">{meta}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function SectionTitle({ icon, children, count }: { icon: ReactNode; children: ReactNode; count: number }) {
  return (
    <h2 className="flex items-center gap-2 pt-3 text-[16px] font-semibold text-text first:pt-0">
      {icon}
      {children}
      <span className="tabular-nums text-dim">{count}</span>
    </h2>
  );
}

export function ApplyDialog({ instanceId, setIds, only, onClose }: { instanceId: string; setIds: string[]; only?: string[]; onClose: () => void }) {
  const t = useT();
  const inst = useInstances().data?.find((i) => i.id === instanceId);
  const sets = useSets().data ?? [];
  const q = useQuery({
    queryKey: ["mod-sets", "preview", instanceId, setIds, only ?? null],
    queryFn: () => setsApi.preview(instanceId, setIds, only),
    staleTime: 0,
    gcTime: 0,
    retry: 0,
  });
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  const [showInstalled, setShowInstalled] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const task = useTask(taskId);

  useEffect(() => {
    if (q.data) setChoice(Object.fromEntries(q.data.items.map((it) => [it.key, initialChoice(it)])));
  }, [q.data]);

  useEffect(() => {
    if (task?.status === "done") {
      queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
      invalidateSets();
    }
  }, [task?.status, instanceId]);

  const items = q.data?.items ?? [];
  const groups = useMemo(
    () => ({
      install: items.filter((i) => i.status === "install"),
      conflict: items.filter((i) => i.status === "conflict"),
      unavailable: items.filter((i) => i.status === "unavailable"),
      installed: items.filter((i) => i.status === "installed"),
    }),
    [items],
  );
  const picks: Pick[] = items.flatMap((it) => {
    const c = choice[it.key];
    if (c === "main") return [{ source: it.entry.source, project_id: it.entry.project_id, version_id: it.version_id }];
    if (typeof c === "number" && it.alternatives[c]) {
      const a = it.alternatives[c];
      return [{ source: a.source, project_id: a.project_id, version_id: a.version_id }];
    }
    return [];
  });
  const deps = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) if (choice[it.key] === "main") for (const d of it.deps) m.set(d.key, d.title);
    return m.size;
  }, [items, choice]);

  const setName = sets.find((s) => s.id === setIds[0])?.name ?? "";
  const title = only ? t("apply.title_news", { set: setName }) : setIds.length > 1 ? t("apply.title_multi", { instance: inst?.name ?? "" }) : t("apply.title", { set: setName, instance: inst?.name ?? "" });
  const running = !!taskId && (!task || task.status === "running");
  const finished = task && task.status !== "running";

  const start = async () => {
    setStarting(true);
    try {
      setTaskId(await setsApi.apply(instanceId, setIds, picks));
    } catch (e) {
      toast.error(e, t("apply.failed"));
    } finally {
      setStarting(false);
    }
  };

  const dismiss = async () => {
    try {
      for (const id of setIds) await setsApi.dismissNews(instanceId, id);
      queryClient.invalidateQueries({ queryKey: ["mod-sets", "news", instanceId] });
      toast.info(t("apply.dismissed"));
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };

  const toggle = (key: string, c: Choice) => setChoice((s) => ({ ...s, [key]: s[key] === c ? null : c }));
  const mc = q.data?.mc_version ?? inst?.mc_version ?? "";
  const loader = q.data?.loader ?? inst?.loader.kind ?? "vanilla";

  const body = () => {
    if (taskId)
      return (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          {task?.status === "done" ? (
            <span className="grid h-12 w-12 place-items-center rounded-pill bg-ok/15 text-ok">
              <Check size={24} />
            </span>
          ) : task?.status === "failed" || task?.status === "cancelled" ? (
            <span className="grid h-12 w-12 place-items-center rounded-pill bg-danger/15 text-danger">
              <AlertTriangle size={22} />
            </span>
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-pill bg-brand/15 text-brand">
              <Download size={22} />
            </span>
          )}
          <div className="text-[15px] font-semibold text-text">
            {task?.status === "done" ? t("apply.done") : task?.status === "failed" ? t("apply.failed") : t("apply.running")}
          </div>
          <div className="max-w-[420px] text-[13px] text-muted">{task?.status === "failed" ? task.error : task?.message}</div>
          {running && <Progress value={task?.progress ?? null} className="w-[360px]" />}
        </div>
      );
    if (q.isPending)
      return (
        <div className="flex flex-col gap-2">
          <div className="mb-1 text-[14px] text-muted">{t("apply.loading")}</div>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[46px]" />
          ))}
        </div>
      );
    if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-8" />;
    if (!items.length)
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-[13px] text-muted">
          <ShieldCheck size={28} className="text-ok" />
          {t("apply.all_there")}
        </div>
      );
    return (
      <div className="flex flex-col gap-2">
        {groups.install.length > 0 && (
          <>
            <SectionTitle icon={<Download size={13} className="text-brand" />} count={groups.install.length}>
              {t("apply.sec.install")}
            </SectionTitle>
            {groups.install.map((it) => (
              <Row
                key={it.key}
                onClick={() => toggle(it.key, "main")}
                icon={
                  <>
                    <Checkbox checked={choice[it.key] === "main"} onChange={noop} label={it.entry.title} />
                    <ProjectIcon src={it.entry.icon_url} size={32} />
                  </>
                }
                title={
                  <>
                    {it.entry.title} <span className="ml-1 text-meta font-normal text-dim">{it.version_number}</span>
                  </>
                }
                meta={
                  (it.deps.length > 0 || it.manual) && (
                    <>
                      {it.deps.length > 0 && <span>{t("apply.deps", { list: it.deps.map((d) => d.title).join(", ") })}</span>}
                      {it.manual && <span className="text-warn">{it.deps.length ? " · " : ""}{t("apply.manual")}</span>}
                    </>
                  )
                }
              />
            ))}
          </>
        )}
        {groups.conflict.length > 0 && (
          <>
            <SectionTitle icon={<AlertTriangle size={13} className="text-warn" />} count={groups.conflict.length}>
              {t("apply.sec.conflict")}
            </SectionTitle>
            {groups.conflict.map((it) => (
              <Row
                key={it.key}
                onClick={() => toggle(it.key, "main")}
                icon={
                  <>
                    <Checkbox checked={choice[it.key] === "main"} onChange={noop} label={it.entry.title} />
                    <ProjectIcon src={it.entry.icon_url} size={32} />
                  </>
                }
                title={
                  <>
                    {it.entry.title} <span className="ml-1 text-meta font-normal text-dim">{it.version_number}</span>
                  </>
                }
                meta={<span className="text-warn">{t("apply.conflict", { list: it.conflicts.join(", ") })}</span>}
              />
            ))}
          </>
        )}
        {groups.unavailable.length > 0 && (
          <>
            <SectionTitle icon={<CircleSlash size={13} className="text-dim" />} count={groups.unavailable.length}>
              {t("apply.sec.unavailable")}
            </SectionTitle>
            {groups.unavailable.map((it) => (
              <Row
                key={it.key}
                dim
                icon={
                  <>
                    <span className="w-[18px]" />
                    <ProjectIcon src={it.entry.icon_url} size={32} className="opacity-60" />
                  </>
                }
                title={it.entry.title}
                meta={reasonText(t, it.reason ?? "failed", { loaders: it.loaders, mcRange: it.mc_range, mc, loader, message: it.message })}
              >
                {it.alternatives.map((a, i) => (
                  <div
                    key={`${a.project_id}-${a.version_id}`}
                    onClick={() => toggle(it.key, i)}
                    className="ml-[30px] mt-1 flex items-center gap-3 rounded-ctl px-2 py-1.5 hover:bg-white/[.03]"
                  >
                    <Checkbox checked={choice[it.key] === i} onChange={noop} label={a.title} />
                    <ArrowRight size={13} className="shrink-0 text-dim" />
                    <ProjectIcon src={a.icon_url} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-text">
                        {a.kind === "older_mc"
                          ? t("apply.alt.older_mc", { mc: a.mc_version ?? "?", version: a.version_number })
                          : t("apply.alt.other_project", { title: a.title, version: a.version_number })}
                      </div>
                      <div className={cn("text-[12px]", a.kind === "older_mc" ? "text-warn" : "text-dim")}>
                        {a.kind === "older_mc" ? t("apply.alt.older_mc_hint") : t("apply.alt.other_project_hint")}
                      </div>
                    </div>
                  </div>
                ))}
              </Row>
            ))}
          </>
        )}
        {groups.installed.length > 0 && (
          <>
            <button
              onClick={() => setShowInstalled((v) => !v)}
              className="flex items-center gap-2 px-2 pb-1 pt-3 text-left text-[12.5px] font-semibold text-muted hover:text-text"
            >
              <Check size={13} className="text-ok" />
              {t("apply.sec.installed")}
              <span className="tabular-nums text-dim">{groups.installed.length}</span>
              <ChevronDown size={13} className={cn("text-dim transition-transform", showInstalled && "rotate-180")} />
            </button>
            {showInstalled &&
              groups.installed.map((it) => (
                <Row
                  key={it.key}
                  dim
                  icon={
                    <>
                      <span className="w-[18px]" />
                      <ProjectIcon src={it.entry.icon_url} size={28} />
                    </>
                  }
                  title={it.entry.title}
                  meta={it.covered_by ? t("apply.covered_by", { name: it.covered_by }) : it.installed_as ? t("apply.installed_as", { name: it.installed_as }) : undefined}
                />
              ))}
          </>
        )}
      </div>
    );
  };

  const summary = q.data && !taskId && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
      <span>{t("apply.for", { mc, loader: loaderNames[loader] })}</span>
      <span className="h-3 w-px bg-line2" />
      {groups.install.length > 0 && <span className="text-text">{t("apply.sum.install", { n: groups.install.length })}</span>}
      {groups.installed.length > 0 && <span>{t("apply.sum.installed", { n: groups.installed.length })}</span>}
      {groups.unavailable.length > 0 && <span>{t("apply.sum.unavailable", { n: groups.unavailable.length })}</span>}
      {groups.conflict.length > 0 && <span className="text-warn">{t("apply.sum.conflict", { n: groups.conflict.length })}</span>}
      {deps > 0 && <span>{t("apply.sum.deps", { n: deps })}</span>}
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={summary || undefined}
      size="xl"
      className="[&_.vl-dialog-foot]:flex-wrap"
      locked={running}
      footer={
        finished ? (
          <Button variant="primary" onClick={onClose}>
            {t("apply.close")}
          </Button>
        ) : taskId ? null : (
          <>
            {only && (
              <Button variant="subtle" onClick={() => void dismiss()}>
                {t("apply.dismiss")}
              </Button>
            )}
            <Button variant="subtle" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon={<Download size={14} />} disabled={!picks.length} loading={starting || q.isPending} onClick={() => void start()}>
              {q.isPending ? t("common.install") : picks.length ? t("apply.install_n", { n: picks.length }) : t("apply.nothing")}
            </Button>
          </>
        )
      }
    >
      {q.data && !taskId && (
        <p className="mb-4 flex items-center gap-2 rounded-card bg-ok/[.08] px-4 py-3 text-[14px] text-text">
          <ShieldCheck size={17} className="shrink-0 text-ok" />
          {t("apply.backup")}
        </p>
      )}
      {body()}
    </Dialog>
  );
}
