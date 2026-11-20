// Einstellungen → „Vibe & Konto“: Hauptschalter, Vibe-Konto (Status, Verknüpfung, Löschen), Privatsphäre,
// einzelne Funktionen und Discord Rich Presence.
import { useQuery } from "@tanstack/react-query";
import { CloudOff } from "lucide-react";
import { api } from "@/lib/api";
import type { Settings, VibeServices } from "@/lib/types";
import { SettingRow, SettingsCard, Switch } from "@/components/ui";
import { useT } from "@/i18n";
import { VibeAccountCard, VibeDangerCard, VibePrivacyCard } from "@/features/social/VibeAccountSettings";
import { useSimple } from "@/lib/mode";
import { DiscordArtRows } from "./discord/DiscordArtRows";

const SUBS: (keyof Pick<VibeServices, "social" | "presence" | "hosting" | "sharing">)[] = ["social", "presence", "hosting", "sharing"];

export function VibeTab({ settings: s, update }: { settings: Settings; update: (p: Partial<Settings>, delay?: number) => void }) {
  const t = useT();
  // Simple-Modus: nur Vibe an/aus und das Vibe-Konto
  const simple = useSimple();
  const discord = useQuery({ queryKey: ["discord-available"], queryFn: api.discordAvailable, staleTime: Infinity });
  const v = s.vibe;
  const setVibe = (p: Partial<VibeServices>, delay?: number) => update({ vibe: { ...v, ...p } }, delay);
  return (
    <>
      <SettingsCard title={t("settings.section.vibe")}>
        <SettingRow title={t("vibe.enabled")} description={t("vibe.enabled.desc")}>
          <Switch checked={v.enabled} onChange={(enabled) => setVibe({ enabled })} label={t("vibe.enabled")} />
        </SettingRow>
        {!v.enabled && (
          <div className="flex items-center gap-2.5 border-t border-line px-4 py-3 text-meta text-muted">
            <CloudOff size={14} className="shrink-0 text-dim" />
            {t("vibe.off_hint")}
          </div>
        )}
      </SettingsCard>

      {v.enabled && (
        <>
          <VibeAccountCard />
          {!simple && (
          <>
          <SettingsCard title={t("vibe.features")}>
            {SUBS.map((k) => (
              <SettingRow key={k} title={t(`vibe.${k}`)} description={t(`vibe.${k}.desc`)}>
                <Switch checked={v[k]} onChange={(on) => setVibe({ [k]: on })} label={t(`vibe.${k}`)} />
              </SettingRow>
            ))}
          </SettingsCard>
          <VibePrivacyCard />
          </>
          )}
        </>
      )}

      <SettingsCard title="Discord">
        <SettingRow
          title={t("vibe.discord")}
          description={discord.data === false ? `${t("vibe.discord.desc")} ${t("vibe.discord.unavailable")}` : t("vibe.discord.desc")}
        >
          <Switch checked={s.discord_rpc} onChange={(discord_rpc) => update({ discord_rpc })} label={t("vibe.discord")} />
        </SettingRow>
        {!simple && (
          <SettingRow title={t("vibe.discord.details")} description={t("vibe.discord.details.desc")}>
            <Switch
              checked={s.discord_details}
              disabled={!s.discord_rpc}
              onChange={(discord_details) => update({ discord_details })}
              label={t("vibe.discord.details")}
            />
          </SettingRow>
        )}
        {s.discord_rpc && <DiscordArtRows settings={s} update={update} />}
      </SettingsCard>

      {!simple && v.enabled && <VibeDangerCard />}
    </>
  );
}
