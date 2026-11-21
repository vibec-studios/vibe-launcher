import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk, useSettings, useSystemInfo } from "@/lib/queries";
import type { JavaOptions } from "@/lib/types";
import { Input, Select, SettingRow, SettingsCard, Switch } from "@/components/ui";
import { JavaPathField, MemoryField } from "@/components/instance/forms";
import { useT } from "@/i18n";
import { GpuRow } from "@/features/perf/PerfControls";
import { HelpLink } from "@/features/help/HelpButton";
import type { TabProps } from "./types";

/** JVM-Flag-Vorlagen (Content-Agent). */
export const JVM_PRESETS: Record<"g1" | "zgc" | "low", string> = {
  g1: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1",
  zgc: "-XX:+UseZGC -XX:+ZGenerational -XX:+AlwaysPreTouch -XX:+DisableExplicitGC",
  low: "-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:+UseStringDeduplication -XX:+DisableExplicitGC",
};

/** RAM-Empfehlung (MB) nach Mod-Anzahl, höchstens die Hälfte des Systemspeichers. */
export function recommendRam(mods: number, totalMb: number): number {
  const gb = mods === 0 ? 2 : mods <= 30 ? 3 : mods <= 80 ? 4 : mods <= 150 ? 6 : mods <= 250 ? 8 : 10;
  return Math.max(2048, Math.min(gb * 1024, Math.floor(totalMb / 2 / 512) * 512));
}


// ------------------------------------------------------------------ Java & Speicher

export function JavaTab({ instance, d, update }: TabProps) {
  const t = useT();
  const { data: settings } = useSettings();
  const { data: sys } = useSystemInfo();
  const java = (p: Partial<JavaOptions>, delay = 0) => update({ java: { ...d.java, ...p } }, delay);
  const ramOverride = d.java.max_memory_mb !== null || d.java.min_memory_mb !== null;
  const modsQ = useQuery({ queryKey: qk.content(instance.id, "mod"), queryFn: () => api.contentList(instance.id, "mod"), staleTime: 60_000 });
  const modCount = modsQ.data?.filter((m) => m.enabled).length ?? null;
  const total = sys?.total_memory_mb ?? 8192;
  return (
    <>
      <SettingsCard title={t("isd.section.java")}>
        <SettingRow title={t("isettings.java.path")} description={t("isettings.java.path.desc")} stacked>
          <JavaPathField value={d.java.path} onChange={(path, delay) => java({ path }, delay)} />
        </SettingRow>
      </SettingsCard>

      <div data-tour="instance-perf">
      <SettingsCard title={t("isd.section.performance")} right={<HelpLink guide="performance" />}>
        <SettingRow
          title={t("isettings.ram")}
          description={
            <>
              {ramOverride ? t("isettings.ram.custom") : t("isettings.ram.global", { min: settings?.min_memory_mb ?? 0, max: settings?.max_memory_mb ?? 0 })}
              {modCount !== null && (
                <span className="mt-1 flex items-center gap-2 text-text">
                  {t("ram.recommend", { n: modCount, gb: recommendRam(modCount, total) / 1024 })}
                  {(d.java.max_memory_mb ?? settings?.max_memory_mb) !== recommendRam(modCount, total) && (
                    <button
                      className="text-[12.5px] font-semibold text-accent hover:underline"
                      onClick={() => java({ min_memory_mb: d.java.min_memory_mb ?? 1024, max_memory_mb: recommendRam(modCount, total) })}
                    >
                      {t("ram.apply")}
                    </button>
                  )}
                </span>
              )}
            </>
          }
        >
          <Switch
            checked={ramOverride}
            label={t("isettings.override")}
            onChange={(on) =>
              java(on ? { min_memory_mb: settings?.min_memory_mb ?? 512, max_memory_mb: settings?.max_memory_mb ?? 4096 } : { min_memory_mb: null, max_memory_mb: null })
            }
          />
        </SettingRow>
        {ramOverride && (
          <div className="border-t border-line px-4 py-4">
            <MemoryField
              min={d.java.min_memory_mb ?? 512}
              max={d.java.max_memory_mb ?? 4096}
              total={total}
              onChange={(v, delay) => java({ min_memory_mb: v.min, max_memory_mb: v.max }, delay)}
            />
          </div>
        )}
        <GpuRow />
        <SettingRow title={t("isettings.jvm")} description={t("isettings.jvm.desc")} stacked>
          <div className="mb-2 w-[260px]">
            <Select<"none" | "g1" | "zgc" | "low">
              size="sm"
              placeholder={t("jvm.presets")}
              value={
                !d.java.jvm_args ? "none" : ((Object.entries(JVM_PRESETS).find(([, v]) => v === d.java.jvm_args)?.[0] as "g1" | "zgc" | "low" | undefined) ?? null)
              }
              onChange={(v) => java({ jvm_args: v === "none" ? null : JVM_PRESETS[v] })}
              options={(["none", "g1", "zgc", "low"] as const).map((v) => ({ value: v, label: t(`jvm.preset.${v}`) }))}
            />
          </div>
          <Input
            className="font-mono text-[12px]"
            value={d.java.jvm_args ?? ""}
            placeholder={settings?.jvm_args || "-XX:+UseG1GC"}
            onChange={(e) => java({ jvm_args: e.target.value || null }, 700)}
          />
        </SettingRow>
      </SettingsCard>
      </div>
    </>
  );
}
