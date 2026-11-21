import { Button, Dialog, Select, SettingRow, SettingsCard, Switch, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { patchSettings } from "@/lib/mode";
import { useSettings, useSystemInfo } from "@/lib/queries";
import type { Instance, JavaOptions } from "@/lib/types";
import { levelOf, levelsFor, PERF_LEVELS, type PerfLevel } from "./ram";
import { HelpLink } from "@/features/help/HelpButton";

const gb = (mb: number) => Math.round((mb / 1024) * 10) / 10;

export function RamDialog({ open, onClose, instance, suggestion, onApply, onDismiss }: { open: boolean; onClose: () => void; instance: Instance; suggestion: number; onApply: () => Promise<void>; onDismiss: () => void }) {
  const t = useT();
  const { data: settings } = useSettings();
  const { data: sys } = useSystemInfo();
  const now = instance.java.max_memory_mb ?? settings?.max_memory_mb ?? 2048;
  const apply = async () => {
    try {
      await onApply();
      toast.success(t("perf.ram.applied", { gb: gb(suggestion) }));
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("perf.ram.title")}
      description={t("perf.ram.text", { now: gb(now), total: gb(sys?.total_memory_mb ?? 0), gb: gb(suggestion) })}
      size="sm"
      footer={
        <>
          <Button
            variant="subtle"
            className="mr-auto"
            onClick={() => {
              onDismiss();
              onClose();
            }}
          >
            {t("perf.ram.dismiss")}
          </Button>
          <Button variant="primary" autoFocus onClick={apply}>
            {t("perf.ram.apply", { gb: gb(suggestion) })}
          </Button>
        </>
      }
    />
  );
}

export function GpuRow() {
  const t = useT();
  const { data: settings } = useSettings();
  const { data: sys } = useSystemInfo();
  if (sys?.os !== "windows") return null;
  const on = !!settings?.prefer_dgpu;
  const set = async (v: boolean) => {
    try {
      await patchSettings({ prefer_dgpu: v });
      toast.success(v ? t("perf.gpu.on") : t("perf.gpu.off"));
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <SettingRow title={t("perf.gpu")} description={t("perf.gpu.desc")}>
      <Switch checked={on} label={t("perf.gpu")} onChange={set} />
    </SettingRow>
  );
}

export function SimplePerfCard({ d, update }: { d: Instance; update: (p: { java: JavaOptions }) => void }) {
  const t = useT();
  const { data: sys } = useSystemInfo();
  const levels = levelsFor(sys?.total_memory_mb ?? 8192);
  const current = levelOf(d.java.max_memory_mb);
  const pick = (id: PerfLevel["id"]) => {
    const mb = PERF_LEVELS.find((l) => l.id === id)?.mb ?? null;
    update({ java: { ...d.java, min_memory_mb: mb === null ? null : Math.min(d.java.min_memory_mb ?? 1024, mb), max_memory_mb: mb } });
  };
  return (
    <SettingsCard title={t("perf.card")} right={<HelpLink guide="performance" />}>
      {!d.bedrock && (
        <SettingRow title={t("perf.level")} description={t("perf.level.desc")}>
          <div className="w-[200px]">
            <Select<PerfLevel["id"]> value={current} onChange={pick} options={levels.map((l) => ({ value: l.id, label: t(`perf.level.${l.id}`) }))} />
          </div>
        </SettingRow>
      )}
      <GpuRow />
    </SettingsCard>
  );
}

export async function openGpuSettings() {
  await api.gpuSettingsOpen().catch((e) => toast.error(e));
}
