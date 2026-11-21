import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FolderOpen, Info, RefreshCcw, ShieldCheck, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { isRunning, useGameState } from "@/lib/queries";
import type { Instance, OptSyncInfo, SyncArea, SyncKey } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { Button, IconButton, SettingRow, SettingsCard, Switch, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { ALL, AREAS, DEFAULT_ON, FOLDER_AREAS, OPTSYNC_KEY, packSelection, sharedOf, useOptSync } from "./shared";
import { AreaRow } from "./AreaRow";

/** Inhalt des Tabs „Synchronisieren“ in den Instanz-Einstellungen. */
export function InstanceSyncTab({ instance }: { instance: Instance }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useOptSync();
  const running = isRunning(useGameState(instance.id));
  const [busy, setBusy] = useState<"set" | "now" | "capture" | null>(null);
  const info = q.data;
  const cur = info?.config.instances[instance.id] ?? { enabled: false, categories: DEFAULT_ON };
  const st = info?.states[instance.id];
  const on = cur.enabled;
  const has = (k: SyncKey) => cur.categories.includes(k);

  const set = async (enabled: boolean, categories: SyncKey[]) => {
    // Sofort anzeigen, das Backend gleicht ggf. gleich ab
    qc.setQueryData<OptSyncInfo>(OPTSYNC_KEY, (d) => (d ? { ...d, config: { ...d.config, instances: { ...d.config.instances, [instance.id]: { enabled, categories } } } } : d));
    setBusy("set");
    try {
      qc.setQueryData(OPTSYNC_KEY, await api.optsyncSetInstance(instance.id, enabled, categories));
    } catch (e) {
      toast.error(e);
      void q.refetch();
    } finally {
      setBusy(null);
    }
  };
  const toggle = (k: SyncKey, v: boolean) => set(true, v ? [...cur.categories.filter((x) => x !== k), k] : cur.categories.filter((x) => x !== k));

  const syncNow = async () => {
    setBusy("now");
    try {
      const r = await api.optsyncSyncNow(instance.id);
      toast.success(r.changes ? t("sync.now_done", { n: r.changes }) : t("sync.now_none"));
      if (r.errors.length) toast.error(r.errors.join("\n"));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: OPTSYNC_KEY });
    }
  };

  const capture = async () => {
    setBusy("capture");
    try {
      qc.setQueryData(OPTSYNC_KEY, await api.optsyncCapture(instance.id, cur.categories));
      toast.success(t("optsync.captured"));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const status = running ? t("sync.status.running") : st?.last_sync ? t("sync.status.last", { when: formatRelative(st.last_sync) }) : on ? t("sync.status.never") : null;
  const count = (a: SyncArea) => {
    const s = sharedOf(info, a);
    return s && s.count > 0 ? <span className="text-[12px] tabular-nums text-dim">{t(`sync.area.count.${a}`, { n: s.count })}</span> : null;
  };

  return (
    <>
      <SettingsCard title={t("isd.tab.sync")}>
        <SettingRow title={t("sync.instance.title")} description={t("sync.instance.desc")}>
          <Switch checked={on} onChange={(v) => void set(v, cur.categories.length ? cur.categories : DEFAULT_ON)} label={t("sync.instance.title")} />
        </SettingRow>
        {on && (
          <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
            <span className={cn("flex-1 text-[12.5px]", running ? "text-warn" : "text-muted")}>{status}</span>
            <Button size="sm" icon={<RefreshCcw size={13} />} loading={busy === "now" || busy === "set"} disabled={running || !AREAS.some(has)} onClick={() => void syncNow()}>
              {t("sync.now")}
            </Button>
          </div>
        )}
      </SettingsCard>

      {on && !!st?.conflicts.length && (
        <div className="flex flex-col gap-2 rounded-card bg-warn/10 px-4 py-3">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-text">
            <AlertTriangle size={15} className="shrink-0 text-warn" />
            <span className="flex-1">{t("sync.conflicts.title")}</span>
            <Button
              size="sm"
              variant="subtle"
              onClick={async () => {
                try {
                  qc.setQueryData(OPTSYNC_KEY, await api.optsyncClearConflicts(instance.id));
                } catch (e) {
                  toast.error(e);
                }
              }}
            >
              {t("sync.conflicts.dismiss")}
            </Button>
          </div>
          <p className="text-[12.5px] text-muted">{t("sync.conflicts.text")}</p>
          <ul className="flex flex-col gap-1">
            {st.conflicts.slice(-8).map((c, i) => (
              <li key={i} className="selectable flex flex-wrap items-center gap-x-1.5 text-[12.5px]">
                <span className="text-dim">{t(`sync.area.${c.area}`)}:</span>
                <span className="font-medium text-text">{c.renamed}</span>
                <span className="text-dim">· {formatRelative(c.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {on && !!st?.errors.length && (
        <div className="flex flex-col gap-1 rounded-card bg-surface px-4 py-3 text-[12.5px] text-muted">
          <span className="flex items-center gap-2 font-medium text-text">
            <Info size={14} className="shrink-0 text-dim" />
            {t("sync.errors")}
          </span>
          {st.errors.slice(0, 5).map((e, i) => (
            <span key={i} className="selectable pl-6">
              {e}
            </span>
          ))}
        </div>
      )}

      <SettingsCard title={t("sync.group.files")}>
        {AREAS.map((a) => (
          <AreaRow
            key={a}
            on={has(a)}
            disabled={!on || busy === "set"}
            title={t(`sync.area.${a}`)}
            desc={t(`sync.area.${a}.desc`)}
            onChange={(v) => void toggle(a, v)}
            note={
              a === "resourcepacks" && has(a) && !packSelection(instance.mc_version) ? (
                <div className="mt-1 text-[12px] text-warn">{t("sync.pre113", { mc: instance.mc_version })}</div>
              ) : undefined
            }
            right={
              <>
                {count(a)}
                {FOLDER_AREAS.includes(a) && (
                  <IconButton size="sm" variant="ghost" label={t("sync.folder.open")} tip={t("sync.folder.open")} onClick={() => void api.optsyncOpenFolder(a).catch(toast.error)}>
                    <FolderOpen size={14} />
                  </IconButton>
                )}
              </>
            }
          />
        ))}
      </SettingsCard>

      <SettingsCard title={t("sync.group.options")}>
        {ALL.map((c) => (
          <AreaRow
            key={c}
            on={has(c)}
            disabled={!on || busy === "set"}
            title={t(`optsync.cat.${c}`)}
            desc={t(`sync.cat.${c}.desc`)}
            onChange={(v) => void toggle(c, v)}
            right={info?.counts[c] ? <span className="text-[12px] tabular-nums text-dim">{info.counts[c]}</span> : undefined}
          />
        ))}
        {on && (
          <SettingRow title={t("sync.master_hint")} description={t("sync.master_hint.desc")}>
            <Button size="sm" icon={<Upload size={13} />} loading={busy === "capture"} disabled={running || !cur.categories.length} onClick={() => void capture()}>
              {t("optsync.capture_this")}
            </Button>
          </SettingRow>
        )}
      </SettingsCard>

      <div className="flex items-start gap-2 px-1 text-[12px] leading-relaxed text-dim">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-ok" />
        {t("sync.safe_note")}
      </div>
    </>
  );
}
