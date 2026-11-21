import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useJavaInstances } from "@/lib/queries";
import type { OptSyncCategory } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { Button, Select, SettingRow, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { ALL, OPTSYNC_KEY, useOptSync } from "./shared";
import { CategoryChips } from "./CategoryChips";

/** Abschnitt in den Launcher-Einstellungen: Master-Profil der Spieleinstellungen verwalten. */
export function MasterOptSync() {
  const t = useT();
  const qc = useQueryClient();
  const q = useOptSync();
  const { data: instances = [] } = useJavaInstances();
  const [from, setFrom] = useState<string | null>(null);
  const [cats, setCats] = useState<OptSyncCategory[]>(ALL);
  const [busy, setBusy] = useState(false);
  const info = q.data;
  const total = info ? Object.keys(info.config.master).length + Object.keys(info.config.legacy_keybinds ?? {}).length : 0;
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
