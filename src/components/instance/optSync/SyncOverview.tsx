import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen, RefreshCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useJavaInstances } from "@/lib/queries";
import type { SyncArea } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { Button, IconButton, SettingRow, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { instanceAccent } from "@/lib/format";
import { useT } from "@/i18n";
import { closeSettings } from "@/features/settings/store";
import { openInstanceSettings } from "@/features/instances/settings/store";
import { ALL, AREAS, FOLDER_AREAS, OPTSYNC_KEY, sharedOf, useOptSync } from "./shared";

/** Abschnitt „Synchronisieren“ in den Launcher-Einstellungen: Übersicht und gemeinsame Ordner. */
export function SyncOverview() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useOptSync();
  const { data: instances = [] } = useJavaInstances();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const info = q.data;
  const synced = instances.filter((i) => info?.config.instances[i.id]?.enabled);

  const syncAll = async () => {
    setBusy(true);
    try {
      const r = await api.optsyncSyncNow(null);
      const parts = [t("sync.overview.result", { k: r.instances, n: r.changes })];
      if (r.conflicts) parts.push(r.conflicts === 1 ? t("sync.overview.conflicts_1") : t("sync.overview.conflicts", { n: r.conflicts }));
      if (r.running.length) parts.push(t("sync.overview.skipped", { names: r.running.join(", ") }));
      setResult(parts.join(" · "));
      if (r.errors.length) toast.error(r.errors.slice(0, 4).join("\n"));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: OPTSYNC_KEY });
    }
  };

  const edit = (id: string) => {
    closeSettings();
    void nav({ to: "/instances/$id", params: { id }, search: { tab: "content" } });
    openInstanceSettings(id, "sync");
  };

  return (
    <>
      <SettingRow title={t("sync.overview.instances")} description={synced.length ? undefined : t("sync.overview.none")} stacked={synced.length > 0}>
        {synced.length > 0 && (
          <div className="flex flex-col gap-1">
            {synced.map((i) => {
              const c = info!.config.instances[i.id];
              const st = info!.states[i.id];
              const keys = [...AREAS, ...ALL].filter((k) => c.categories.includes(k));
              return (
                <div key={i.id} className="flex items-center gap-3 rounded-ctl bg-surface2 px-3 py-2">
                  <InstanceIcon icon={i.icon} seed={i.id} accent={instanceAccent(i.id, i.accent)} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13.5px] font-semibold text-text">{i.name}</span>
                      {!!st?.conflicts.length && <span className="shrink-0 rounded-xs bg-warn/15 px-1.5 py-px text-[11px] font-semibold text-warn">{st.conflicts.length === 1 ? t("sync.overview.conflicts_1") : t("sync.overview.conflicts", { n: st.conflicts.length })}</span>}
                    </div>
                    <div className="truncate text-[12px] text-muted">
                      {keys.map((k) => (AREAS.includes(k as SyncArea) ? t(`sync.area.${k}`) : t(`optsync.cat.${k}`))).join(" · ") || "–"}
                      {st?.last_sync ? <span className="text-dim"> · {formatRelative(st.last_sync)}</span> : null}
                    </div>
                  </div>
                  <Button size="sm" variant="subtle" onClick={() => edit(i.id)}>
                    {t("sync.overview.edit")}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </SettingRow>
      <SettingRow title={t("sync.overview.folders")} description={t("sync.overview.folders.desc")} stacked>
        <div className="grid grid-cols-2 gap-1.5 max-[700px]:grid-cols-1">
          {AREAS.filter((a) => FOLDER_AREAS.includes(a) || a === "servers").map((a) => {
            const s = sharedOf(info, a);
            const folder = FOLDER_AREAS.includes(a);
            return (
              <div key={a} className="flex items-center gap-3 rounded-ctl bg-surface2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-text">{t(`sync.folder.${a}`)}</div>
                  <div className="truncate text-[12px] tabular-nums text-muted">
                    {folder ? t("sync.overview.count", { n: s?.count ?? 0, size: formatBytes(s?.size ?? 0) }) : t("sync.area.count.servers", { n: s?.count ?? 0 })}
                  </div>
                </div>
                {folder && (
                  <IconButton size="sm" variant="ghost" label={t("sync.folder.open")} tip={t("sync.folder.open")} onClick={() => void api.optsyncOpenFolder(a).catch(toast.error)}>
                    <FolderOpen size={14} />
                  </IconButton>
                )}
              </div>
            );
          })}
        </div>
      </SettingRow>
      <SettingRow title={t("sync.overview.all")} description={result ?? t("sync.overview.all.desc")}>
        <Button icon={<RefreshCcw size={14} />} loading={busy} disabled={!synced.length} onClick={() => void syncAll()}>
          {t("sync.now")}
        </Button>
      </SettingRow>
    </>
  );
}
