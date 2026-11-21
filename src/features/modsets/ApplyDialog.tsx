// OWNER: Content-Agent. Mod-Set(s) auf eine Instanz anwenden: Vorschau (neu / schon da / nicht verfügbar mit Grund
// und Alternativen / Konflikte), dann Installation als Aufgabe mit Fortschritt im selben Dialog.
import { useQuery } from "@tanstack/react-query";
import { Download, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, ErrorState, Skeleton, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { loaderNames } from "@/lib/format";
import { queryClient, useInstances, useTask } from "@/lib/queries";
import { invalidateSets, setsApi, useSets, type Pick } from "./api";
import { ApplyProgress } from "./apply/ApplyProgress";
import { PreviewGroups } from "./apply/PreviewGroups";
import { initialChoice, type Choice } from "./apply/parts";

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
    if (taskId) return <ApplyProgress task={task} running={running} />;
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
    return <PreviewGroups groups={groups} choice={choice} toggle={toggle} showInstalled={showInstalled} setShowInstalled={setShowInstalled} mc={mc} loader={loader} />;
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
