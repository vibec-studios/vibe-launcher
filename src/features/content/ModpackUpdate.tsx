// OWNER: Content-Agent. Modpack-Updates: Banner (Instanzseite) + Vorschau-Dialog mit Änderungen, dann Anwenden.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpCircle, FileCog, Minus, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Dialog, ErrorState, Skeleton, cn, toast } from "@/components/ui";
import { SideFilterBar, SideTag, countSides, sideMatches, type SideFilter } from "@/components/content/sides";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatLoader } from "@/lib/format";
import { qk, queryClient, waitForTask } from "@/lib/queries";
import type { Instance, ModpackPreviewFile } from "@/lib/types";

export function useModpackUpdate(instance: Instance) {
  const isPack = !!instance.source?.project_id;
  return useQuery({
    queryKey: ["content", instance.id, "modpack-check"],
    queryFn: () => api.modpackCheck(instance.id),
    enabled: isPack,
    staleTime: 10 * 60_000,
    retry: 0,
  });
}

/** Hinweis im Inhalte-Tab, wenn eine neue Pack-Version da ist. */
export function ModpackUpdateBanner({ instance }: { instance: Instance }) {
  const t = useT();
  const q = useModpackUpdate(instance);
  const [open, setOpen] = useState(false);
  const u = q.data;
  if (!u) return null;
  return (
    <>
      <div className="mx-4 mb-2 flex items-center gap-3 border border-accent/40 bg-accent/[.07] px-3.5 py-2.5">
        <ArrowUpCircle size={17} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-white">
            {t("modpack.update_available", { from: u.current_version ?? t("modpack.unknown_version"), to: u.latest.version_number })}
          </div>
          <div className="truncate text-[12.5px] text-muted">{t("modpack.update_text")}</div>
        </div>
        <Button size="sm" variant="accent" onClick={() => setOpen(true)}>
          {t("modpack.show_changes")}
        </Button>
      </div>
      {open && <ModpackUpdateDialog instance={instance} versionId={u.latest.id} onClose={() => setOpen(false)} />}
    </>
  );
}

const changeIcon = { added: <Plus size={13} className="text-ok" />, updated: <RefreshCw size={13} className="text-accent" />, removed: <Minus size={13} className="text-danger" /> };

export function ModpackUpdateDialog({ instance, versionId, onClose }: { instance: Instance; versionId: string | null; onClose: () => void }) {
  const t = useT();
  const q = useQuery({
    queryKey: ["modpack-preview", instance.id, versionId],
    queryFn: () => api.modpackUpdatePreview(instance.id, versionId),
    retry: 0,
    staleTime: 60_000,
  });
  const [side, setSide] = useState<SideFilter>("all");
  const [busy, setBusy] = useState(false);
  const p = q.data;
  const files = useMemo(() => (p?.files ?? []).filter((f) => sideMatches(side, f.side)), [p, side]);
  const counts = useMemo(() => countSides(p?.files ?? [], (f) => f.side), [p]);
  const versionChange = p && (p.mc_from !== p.mc_to || p.loader_from.kind !== p.loader_to.kind || p.loader_from.version !== p.loader_to.version);

  const apply = async () => {
    if (!p) return;
    setBusy(true);
    try {
      const id = await api.modpackUpdate(instance.id, p.target.id);
      onClose();
      waitForTask(id)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["content", instance.id] });
          queryClient.invalidateQueries({ queryKey: qk.instances });
          if (versionChange) api.instanceInstall(instance.id).catch((e) => toast.error(e));
          toast.success(t("modpack.done", { name: instance.name }));
        })
        .catch((e) => toast.error(e));
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  const groups: ModpackPreviewFile["change"][] = ["updated", "added", "removed"];
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("modpack.title")}
      description={p ? t("modpack.description", { name: instance.name, from: p.current_version ?? t("modpack.unknown_version"), to: p.target.version_number }) : instance.name}
      size="lg"
      footer={
        <>
          <span className="mr-auto text-[12px] text-dim">{t("modpack.snapshot_hint")}</span>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!p} loading={busy} onClick={() => void apply()}>
            {t("modpack.apply")}
          </Button>
        </>
      }
    >
      {q.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-8" />
      ) : p ? (
        <div className="flex flex-col gap-4">
          {versionChange && (
            <div className="flex items-start gap-2.5 border border-warn/35 bg-warn/[.06] px-3.5 py-2.5 text-[13px]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
              <div>
                {p.mc_from !== p.mc_to && <div className="font-semibold text-white">{t("modpack.mc_change", { from: p.mc_from, to: p.mc_to })}</div>}
                {(p.loader_from.kind !== p.loader_to.kind || p.loader_from.version !== p.loader_to.version) && (
                  <div className="font-semibold text-white">{t("modpack.loader_change", { from: formatLoader(p.loader_from), to: formatLoader(p.loader_to) })}</div>
                )}
                <div className="text-muted">{t("modpack.reinstall_hint")}</div>
              </div>
            </div>
          )}
          {p.legacy && <div className="text-[12.5px] text-muted">{t("modpack.legacy")}</div>}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-[14px] font-semibold text-white">{t("modpack.files")}</span>
              <span className="text-[12.5px] text-dim">{t("modpack.unchanged", { n: p.unchanged })}</span>
              {p.user_files > 0 && <span className="text-[12.5px] text-dim">{t("modpack.user_files", { n: p.user_files })}</span>}
              <div className="flex-1" />
              {p.files.length > 0 && <SideFilterBar value={side} onChange={setSide} counts={counts} />}
            </div>
            {p.files.length === 0 ? (
              <div className="border border-line px-3 py-4 text-center text-[13px] text-muted">{t("modpack.no_changes")}</div>
            ) : (
              <div className="scroll max-h-[300px] border border-line">
                {groups.map((g) =>
                  files
                    .filter((f) => f.change === g)
                    .map((f) => (
                      <div key={`${g}-${f.path}`} className="flex items-center gap-2.5 border-b border-line/50 px-3 py-1.5 last:border-b-0">
                        {changeIcon[g]}
                        <span className={cn("w-[84px] shrink-0 text-[12px]", g === "removed" ? "text-danger" : g === "added" ? "text-ok" : "text-accent")}>{t(`modpack.${g}`)}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text" title={f.old_path ? `${f.old_path} → ${f.path}` : f.path}>
                          {f.name}
                          <span className="ml-2 text-[11.5px] text-dim">{f.path.split("/").pop()}</span>
                        </span>
                        <SideTag side={f.side} />
                      </div>
                    )),
                )}
              </div>
            )}
          </div>
          {p.overrides.length > 0 && (
            <div>
              <div className="mb-2 text-[14px] font-semibold text-white">{t("modpack.overrides")}</div>
              <div className="scroll max-h-[180px] border border-line">
                {p.overrides.map((o) => (
                  <div key={o.path} className="flex items-center gap-2.5 border-b border-line/50 px-3 py-1.5 last:border-b-0">
                    <FileCog size={13} className={o.status === "conflict" ? "text-warn" : "text-dim"} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">{o.path}</span>
                    <span className={cn("shrink-0 text-[12px]", o.status === "conflict" ? "text-warn" : "text-muted")}>{t(`modpack.override.${o.status}`)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {p.missing.length > 0 && <div className="text-[12.5px] text-warn">{t("modpack.missing", { n: p.missing.length })}</div>}
        </div>
      ) : null}
    </Dialog>
  );
}
