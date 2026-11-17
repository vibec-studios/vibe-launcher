// Einstellungen „Vibe-Dienste“ (optionale Online-Funktionen) und Discord Rich Presence.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import type { Settings, VibeServices } from "@/lib/types";
import { Input, SettingRow, SettingsCard, Switch, cn } from "@/components/ui";
import { useT } from "@/i18n";

const SUBS: (keyof Pick<VibeServices, "social" | "presence" | "hosting" | "sharing">)[] = ["social", "presence", "hosting", "sharing"];

export function VibeCard({ id, settings: s, update }: { id: string; settings: Settings; update: (p: Partial<Settings>, delay?: number) => void }) {
  const t = useT();
  const [advanced, setAdvanced] = useState(false);
  const discord = useQuery({ queryKey: ["discord-available"], queryFn: api.discordAvailable, staleTime: Infinity });
  const v = s.vibe;
  const setVibe = (p: Partial<VibeServices>, delay?: number) => update({ vibe: { ...v, ...p } }, delay);
  return (
    <SettingsCard id={id} title={t("settings.section.vibe")}>
      <SettingRow title={t("vibe.enabled")} description={t("vibe.enabled.desc")}>
        <Switch checked={v.enabled} onChange={(enabled) => setVibe({ enabled })} label={t("vibe.enabled")} />
      </SettingRow>
      {v.enabled && (
        <div className="border-t border-line bg-black/20">
          {SUBS.map((k) => (
            <SettingRow key={k} title={t(`vibe.${k}`)} description={t(`vibe.${k}.desc`)} className="pl-8">
              <Switch checked={v[k]} onChange={(on) => setVibe({ [k]: on })} label={t(`vibe.${k}`)} />
            </SettingRow>
          ))}
          <div className="border-t border-line px-4 py-2.5 pl-8">
            <button onClick={() => setAdvanced(!advanced)} className="flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-white">
              <ChevronDown size={14} className={cn("transition-transform duration-150", !advanced && "-rotate-90")} />
              {t("vibe.advanced")}
            </button>
            {advanced && (
              <div className="mt-3 flex flex-col gap-1.5">
                <span className="label">{t("vibe.api_url")}</span>
                <Input
                  className="font-mono text-[12px]"
                  value={v.api_url}
                  onChange={(e) => setVibe({ api_url: e.target.value }, 800)}
                  placeholder="https://"
                  spellCheck={false}
                />
                <span className="text-[12px] text-dim">{t("vibe.api_url.desc")}</span>
              </div>
            )}
          </div>
        </div>
      )}
      <SettingRow
        title={t("vibe.discord")}
        description={discord.data === false ? `${t("vibe.discord.desc")} ${t("vibe.discord.unavailable")}` : t("vibe.discord.desc")}
      >
        <Switch checked={s.discord_rpc} onChange={(discord_rpc) => update({ discord_rpc })} label={t("vibe.discord")} />
      </SettingRow>
    </SettingsCard>
  );
}
