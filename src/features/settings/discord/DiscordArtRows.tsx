import { useState } from "react";
import { Info } from "lucide-react";
import { api } from "@/lib/api";
import { discordArt, headAccount } from "@/lib/discordArt";
import { useAccounts } from "@/lib/queries";
import type { DiscordLarge, DiscordSmall, Settings } from "@/lib/types";
import { Button, Segmented, SettingRow, Switch, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { DiscordPreview } from "./DiscordPreview";

const LARGE: DiscordLarge[] = ["logo", "app_icon", "head", "custom"];
const SMALL: DiscordSmall[] = ["head", "loader", "none"];

export function DiscordArtRows({ settings: s, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  const t = useT();
  const head = headAccount(useAccounts().data);
  const [busy, setBusy] = useState(false);
  const { large, small, hint } = discordArt(s, head);
  const pick = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({ multiple: false, directory: false, filters: [{ name: t("ap.app_icon.filter"), extensions: ["png", "jpg", "jpeg"] }] });
    if (typeof file !== "string") return;
    setBusy(true);
    try {
      update({ discord_large: "custom", discord_image: await api.appIconImport(file, "discord") });
    } catch (e) {
      toast.error(e, t("ap.app_icon.failed"));
    } finally {
      setBusy(false);
    }
  };
  const setLarge = (v: DiscordLarge) => (v === "custom" && !s.discord_image ? void pick() : update({ discord_large: v }));
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line px-4 py-4">
        <DiscordPreview large={large} small={small} title={t("vibe.discord.preview")} />
        <div className="min-w-[220px] flex-1">
          <div className="text-[13.5px] font-medium text-text">{t("vibe.discord.art")}</div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("vibe.discord.art.desc")}</p>
        </div>
        <Segmented value={s.discord_large} onChange={setLarge} items={LARGE.map((v) => ({ value: v, label: t(`vibe.discord.large.${v}`) }))} />
      </div>
      {hint && (
        <div className="flex items-start gap-2.5 border-t border-line px-4 py-3 text-meta text-muted">
          <Info size={14} className="mt-0.5 shrink-0 text-dim" />
          {t(`vibe.discord.hint.${hint}`)}
        </div>
      )}
      {s.discord_large === "custom" && (
        <SettingRow className="border-t" title={t("vibe.discord.large.custom")} description={t("ap.app_icon.custom_hint")}>
          <Button size="sm" onClick={pick} loading={busy}>
            {s.discord_image ? t("ap.app_icon.change") : t("ap.app_icon.choose")}
          </Button>
        </SettingRow>
      )}
      <SettingRow className="border-t" title={t("vibe.discord.pack")} description={t("vibe.discord.pack.desc")}>
        <Switch checked={s.discord_pack_icon} onChange={(discord_pack_icon) => update({ discord_pack_icon })} label={t("vibe.discord.pack")} />
      </SettingRow>
        <SettingRow className="border-t" title={t("vibe.discord.small")} description={t("vibe.discord.small.desc")}>
          <Segmented
            value={s.discord_small}
            onChange={(discord_small) => update({ discord_small })}
            items={SMALL.map((v) => ({ value: v, label: t(`vibe.discord.small.${v}`) }))}
          />
        </SettingRow>
    </>
  );
}
