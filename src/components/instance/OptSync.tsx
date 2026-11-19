// Optionen-Sync: Schalter + Kategorien je Instanz (Instanz-Einstellungen) und Master-Profil (Launcher-Einstellungen).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useJavaInstances } from "@/lib/queries";
import type { Instance, OptSyncCategory, OptSyncInfo } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { Button, Select, SettingRow, Switch, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";

export const OPTSYNC_KEY = ["optsync"] as const;
const ALL: OptSyncCategory[] = ["controls", "sound", "video", "language", "accessibility"];

export function useOptSync() {
  return useQuery({ queryKey: OPTSYNC_KEY, queryFn: api.optsyncGet, staleTime: 30_000 });
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

/** Karte in den Instanz-Einstellungen. */
export function InstanceOptSync({ instance }: { instance: Instance }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useOptSync();
  const cur = q.data?.config.instances[instance.id] ?? { enabled: false, categories: ALL.filter((c) => c !== "video") };
  const set = async (enabled: boolean, categories: OptSyncCategory[]) => {
    try {
      qc.setQueryData(OPTSYNC_KEY, await api.optsyncSetInstance(instance.id, enabled, categories));
    } catch (e) {
      toast.error(e);
    }
  };
  const masterEmpty = !q.data || Object.keys(q.data.config.master).length === 0;
  return (
    <>
      <SettingRow title={t("optsync.instance.title")} description={t("optsync.instance.desc")}>
        <Switch checked={cur.enabled} onChange={(v) => set(v, cur.categories)} label={t("optsync.instance.title")} />
      </SettingRow>
      {cur.enabled && (
        <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
          <CategoryChips value={cur.categories} onChange={(c) => set(true, c)} />
          {masterEmpty ? (
            <div className="flex items-center gap-3 text-meta text-muted">
              <span className="flex-1">{t("optsync.master_empty")}</span>
              <Button
                size="sm"
                icon={<Upload size={13} />}
                onClick={async () => {
                  try {
                    qc.setQueryData(OPTSYNC_KEY, await api.optsyncCapture(instance.id, cur.categories));
                    toast.success(t("optsync.captured"));
                  } catch (e) {
                    toast.error(e);
                  }
                }}
              >
                {t("optsync.capture_this")}
              </Button>
            </div>
          ) : (
            <p className="text-meta text-dim">{t("optsync.instance.hint")}</p>
          )}
        </div>
      )}
    </>
  );
}

/** Abschnitt in den Launcher-Einstellungen: Master-Profil verwalten. */
export function MasterOptSync() {
  const t = useT();
  const qc = useQueryClient();
  const q = useOptSync();
  const { data: instances = [] } = useJavaInstances();
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
