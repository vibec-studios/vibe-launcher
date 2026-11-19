// Synchronisieren: Tab „Synchronisieren“ in den Instanz-Einstellungen (Schalter + Bereiche, Status, Konflikte) und
// Übersicht in den Launcher-Einstellungen (gemeinsame Ordner, synchronisierte Instanzen, Master-Profil).
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, FolderOpen, Info, RefreshCcw, ShieldCheck, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { isRunning, useGameState, useInstances } from "@/lib/queries";
import type { Instance, OptSyncCategory, OptSyncInfo, SyncArea, SyncKey } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { Button, Checkbox, IconButton, Select, SettingRow, SettingsCard, Switch, cn, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { instanceAccent } from "@/lib/format";
import { useT } from "@/i18n";
import { closeSettings } from "@/features/settings/store";
import { openInstanceSettings } from "@/features/instances/settings/store";

export const OPTSYNC_KEY = ["optsync"] as const;
const ALL: OptSyncCategory[] = ["controls", "sound", "video", "language", "accessibility"];
const AREAS: SyncArea[] = ["resourcepacks", "shaderpacks", "servers", "screenshots"];
const FOLDER_AREAS: SyncArea[] = ["resourcepacks", "shaderpacks", "screenshots"];
/** Vorauswahl beim ersten Einschalten: was fast jeder gleich haben will. Grafik (Leistung je Instanz verschieden),
 *  Shader (brauchen einen Shader-Mod) und Screenshots (optional) bleiben aus. */
const DEFAULT_ON: SyncKey[] = ["controls", "sound", "language", "accessibility", "resourcepacks", "servers"];

export function useOptSync() {
  const qc = useQueryClient();
  // Nach dem Spielen hat der Abgleich evtl. etwas geändert (Backend-Event `sync://changed`)
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    listen("sync://changed", () => void qc.invalidateQueries({ queryKey: OPTSYNC_KEY }))
      .then((f) => (gone ? f() : (off = f)))
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
    };
  }, [qc]);
  return useQuery({ queryKey: OPTSYNC_KEY, queryFn: api.optsyncGet, staleTime: 30_000 });
}

/** Unterstützt diese Version die Pack-Auswahl (ab 1.13)? */
function packSelection(mc: string) {
  const m = /^1\.(\d+)/.exec(mc);
  return !m || Number(m[1]) >= 13;
}

export function CategoryChips({
  value,
  onChange,
  counts,
}: {
  value: OptSyncCategory[];
  onChange: (v: OptSyncCategory[]) => void;
  counts?: OptSyncInfo["counts"];
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-medium transition-colors duration-100",
              on ? "bg-accent/15 text-text hover:bg-accent/20" : "bg-white/[.05] text-muted hover:bg-white/[.08] hover:text-text",
            )}
          >
            {t(`optsync.cat.${c}`)}
            {counts && <span className="text-caption tabular-nums text-dim">{counts[c] ?? 0}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Zeile mit Häkchen, Titel, Erklärung und optionalem Zusatz rechts. */
function AreaRow({ on, disabled, title, desc, right, onChange, note }: { on: boolean; disabled?: boolean; title: string; desc: string; right?: ReactNode; note?: ReactNode; onChange: (v: boolean) => void }) {
  return (
    <div className={cn("flex items-start gap-3 border-line px-4 py-2.5 [&+&]:border-t", disabled && "opacity-55")}>
      <Checkbox checked={on} disabled={disabled} onChange={onChange} label={title} className="mt-[2px]" />
      <button type="button" disabled={disabled} onClick={() => onChange(!on)} className="min-w-0 flex-1 text-left disabled:cursor-default">
        <div className="text-[13.5px] font-medium text-text">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{desc}</div>
        {note}
      </button>
      {right && <div className="flex shrink-0 items-center gap-1.5 self-center">{right}</div>}
    </div>
  );
}

function sharedOf(info: OptSyncInfo | undefined, area: SyncArea) {
  return info?.shared.find((s) => s.area === area);
}

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
            disabled={!on}
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
            disabled={!on}
            title={t(`optsync.cat.${c}`)}
            desc={t(`sync.cat.${c}.desc`)}
            onChange={(v) => void toggle(c, v)}
            right={info?.counts[c] ? <span className="text-[12px] tabular-nums text-dim">{info.counts[c]}</span> : undefined}
          />
        ))}
        {on && (
          <SettingRow title={t("sync.master_hint")} description={t("sync.master_hint.desc")}>
            <Button size="sm" icon={<Upload size={13} />} loading={busy === "capture"} disabled={!cur.categories.length} onClick={() => void capture()}>
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

/** Abschnitt „Synchronisieren“ in den Launcher-Einstellungen: Übersicht und gemeinsame Ordner. */
export function SyncOverview() {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useOptSync();
  const { data: instances = [] } = useInstances();
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
                  <InstanceIcon icon={i.icon} accent={instanceAccent(i.id, i.accent)} size={28} />
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
          {AREAS.map((a) => {
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

/** Abschnitt in den Launcher-Einstellungen: Master-Profil der Spieleinstellungen verwalten. */
export function MasterOptSync() {
  const t = useT();
  const qc = useQueryClient();
  const q = useOptSync();
  const { data: instances = [] } = useInstances();
  const [from, setFrom] = useState<string | null>(null);
  const [cats, setCats] = useState<OptSyncCategory[]>(ALL);
  const [busy, setBusy] = useState(false);
  const info = q.data;
  const total = info ? Object.keys(info.config.master).length : 0;
  const enabledCount = info ? Object.values(info.config.instances).filter((x) => x.enabled).length : 0;
  const src = info?.config.source ? instances.find((i) => i.id === info.config.source)?.name : null;
  const source = from ?? info?.config.source ?? instances[0]?.id ?? null;

  return (
    <>
      <SettingRow
        title={t("optsync.master.title")}
        description={
          total
            ? t("optsync.master.status", {
                n: total,
                src: src ?? "–",
                when: info?.config.updated_at ? formatRelative(info.config.updated_at) : "–",
                k: enabledCount,
              })
            : t("optsync.master.none")
        }
        stacked
      >
        {info && <CategoryChips value={cats} onChange={setCats} counts={info.counts} />}
      </SettingRow>
      <SettingRow title={t("optsync.capture")} description={t("optsync.capture.desc")}>
        <div className="flex items-center gap-2">
          <div className="w-[220px]">
            <Select
              value={source}
              onChange={setFrom}
              options={instances.map((i) => ({ value: i.id, label: i.name }))}
              placeholder={t("optsync.pick_instance")}
            />
          </div>
          <Button
            icon={<Upload size={14} />}
            loading={busy}
            disabled={!source || !cats.length}
            onClick={async () => {
              setBusy(true);
              try {
                qc.setQueryData(OPTSYNC_KEY, await api.optsyncCapture(source!, cats));
                toast.success(t("optsync.captured"));
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("optsync.capture_btn")}
          </Button>
        </div>
      </SettingRow>
      <SettingRow title={t("optsync.apply")} description={t("optsync.apply.desc")}>
        <Button
          icon={<RefreshCcw size={14} />}
          disabled={!total || !enabledCount}
          onClick={async () => {
            try {
              const n = await api.optsyncApplyAll();
              toast.success(t("optsync.applied", { n }));
            } catch (e) {
              toast.error(e);
            }
          }}
        >
          {t("optsync.apply_btn")}
        </Button>
      </SettingRow>
    </>
  );
}
