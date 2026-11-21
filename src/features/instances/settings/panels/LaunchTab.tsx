import { useSettings, useSystemInfo } from "@/lib/queries";
import type { LaunchHooks, WindowOptions } from "@/lib/types";
import { Input, NumberInput, SettingRow, SettingsCard, Switch } from "@/components/ui";
import { useT } from "@/i18n";
import { useExpert } from "@/lib/simple-mode";
import { ExpertHint } from "@/features/simple/ExpertHint";
import type { TabProps } from "./types";

export const NO_HOOKS: LaunchHooks = { pre_launch: null, post_exit: null, wrapper: null };


// ------------------------------------------------------------------ Fenster & Start

export function LaunchTab({ d, update }: TabProps) {
  const t = useT();
  const showHooks = useExpert("launch-hooks");
  const { data: settings } = useSettings();
  const { data: sys } = useSystemInfo();
  const win = (p: Partial<WindowOptions>, delay = 0) => update({ window: { ...d.window, ...p } }, delay);
  const hooks = d.hooks ?? NO_HOOKS;
  const hook = (p: Partial<LaunchHooks>, delay = 700) => update({ hooks: { ...hooks, ...p } }, delay);
  const winOverride = d.window.width !== null || d.window.height !== null || d.window.fullscreen !== null;
  const win32 = (sys?.os ?? "").toLowerCase().startsWith("win");
  const vars = ["INST_ID", "INST_NAME", "INST_DIR", "INST_MC_DIR", "INST_MC_VER", "INST_LOADER", "INST_JAVA"].map((v) => (win32 ? `%${v}%` : `$${v}`)).join(", ");
  return (
    <>
      <SettingsCard title={t("isettings.window")}>
        <SettingRow
          title={t("isettings.window.override")}
          description={winOverride ? t("isettings.window.custom") : t("isettings.window.global", { w: settings?.game_width ?? 0, h: settings?.game_height ?? 0 })}
        >
          <Switch
            checked={winOverride}
            label={t("isettings.override")}
            onChange={(on) =>
              win(
                on
                  ? { width: settings?.game_width ?? 1280, height: settings?.game_height ?? 720, fullscreen: settings?.fullscreen ?? false }
                  : { width: null, height: null, fullscreen: null },
              )
            }
          />
        </SettingRow>
        {winOverride && (
          <>
            <SettingRow title={t("settings.resolution")}>
              <div className="flex items-center gap-2">
                <NumberInput className="w-[110px]" value={d.window.width} min={320} max={7680} unit="px" onChange={(w) => win({ width: w })} aria-label="width" />
                <span className="text-dim">×</span>
                <NumberInput className="w-[110px]" value={d.window.height} min={240} max={4320} unit="px" onChange={(h) => win({ height: h })} aria-label="height" />
              </div>
            </SettingRow>
            <SettingRow title={t("settings.fullscreen")}>
              <Switch checked={!!d.window.fullscreen} onChange={(v) => win({ fullscreen: v })} label={t("settings.fullscreen")} />
            </SettingRow>
          </>
        )}
      </SettingsCard>

      <ExpertHint text={t("usab.expert.hooks")} />

      {showHooks && (
      <SettingsCard title={t("isd.hooks")}>
        <SettingRow title={t("isd.hooks.pre")} description={t("isd.hooks.pre.desc")} stacked>
          <Input className="font-mono text-[12px]" value={hooks.pre_launch ?? ""} placeholder={win32 ? "backup.bat" : "./backup.sh"} onChange={(e) => hook({ pre_launch: e.target.value || null })} />
        </SettingRow>
        <SettingRow title={t("isd.hooks.post")} description={t("isd.hooks.post.desc")} stacked>
          <Input className="font-mono text-[12px]" value={hooks.post_exit ?? ""} onChange={(e) => hook({ post_exit: e.target.value || null })} />
        </SettingRow>
        <SettingRow
          title={t("isd.hooks.wrapper")}
          description={t("isd.hooks.wrapper.desc", { global: settings?.wrapper_command || t("isd.hooks.wrapper.none") })}
          stacked
        >
          <Input
            className="font-mono text-[12px]"
            value={hooks.wrapper ?? ""}
            placeholder={settings?.wrapper_command || "gamemoderun"}
            onChange={(e) => hook({ wrapper: e.target.value.trim() ? e.target.value : null })}
          />
        </SettingRow>
        <div className="border-t border-line px-4 py-2.5 text-[12px] text-dim">
          <span className="font-mono">{t("isd.hooks.vars", { vars })}</span>
        </div>
      </SettingsCard>
      )}
    </>
  );
}
