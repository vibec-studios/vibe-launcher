import { FlaskConical, ShieldAlert } from "lucide-react";
import { SettingRow, SettingsCard, Switch } from "@/components/ui";
import { useT } from "@/i18n";
import type { Settings } from "@/lib/types";
import { AFK_DEFAULTS, type AfkSettings } from "./types";

export function afkSettings(s: Settings | undefined): AfkSettings {
  return { ...AFK_DEFAULTS, ...(s?.afk ?? {}) };
}

export function AfkRulesNote({ className }: { className?: string }) {
  const t = useT();
  return (
    <div className={`flex items-start gap-2.5 rounded-ctl bg-warn/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-text ${className ?? ""}`}>
      <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warn" />
      <span>{t("afk.rules")}</span>
    </div>
  );
}

export function AfkSettingsCard({ s, update }: { s: Settings; update: (p: Partial<Settings>, delay?: number) => void }) {
  const t = useT();
  const a = afkSettings(s);
  const set = (patch: Partial<AfkSettings>) => update({ afk: { ...a, ...patch } });
  return (
    <div data-testid="afk-settings">
      <SettingsCard
        title={t("afk.section")}
        right={
          <span className="flex items-center gap-1 rounded-dot bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">
            <FlaskConical size={11} />
            {t("afk.badge")}
          </span>
        }
      >
        <SettingRow title={t("afk.enabled")} description={t("afk.enabled.desc")}>
          <Switch checked={a.enabled} onChange={(enabled) => set({ enabled })} label={t("afk.enabled")} />
        </SettingRow>
        {a.enabled && (
          <>
            <SettingRow title={t("afk.always")} description={t("afk.always.desc")}>
              <Switch checked={a.always_ready} onChange={(always_ready) => set({ always_ready })} label={t("afk.always")} />
            </SettingRow>
            <SettingRow title={t("afk.notify")} description={t("afk.notify.desc")}>
              <Switch checked={a.notify} onChange={(notify) => set({ notify })} label={t("afk.notify")} />
            </SettingRow>
            <SettingRow title={t("afk.reconnect")} description={t("afk.reconnect.desc")}>
              <Switch checked={a.auto_reconnect} onChange={(auto_reconnect) => set({ auto_reconnect })} label={t("afk.reconnect")} />
            </SettingRow>
            <SettingRow title={t("afk.fallback")} description={t("afk.fallback.desc")}>
              <Switch checked={a.options_fallback} onChange={(options_fallback) => set({ options_fallback })} label={t("afk.fallback")} />
            </SettingRow>
            <div className="border-t border-line px-4 py-3">
              <AfkRulesNote />
            </div>
          </>
        )}
      </SettingsCard>
    </div>
  );
}
