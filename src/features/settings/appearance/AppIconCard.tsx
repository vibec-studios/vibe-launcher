import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Segmented, SettingRow, SettingsCard, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { AccentPicker } from "./AccentPicker";
import type { CardProps } from "./types";

/** App-Icon: Motiv (Robbe, Pinguin, eigenes Bild), Kachelfarbe und Live-Vorschau. */
export function AppIconCard({ a, set }: CardProps) {
  const t = useT();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .appIconPreview(a.app_icon, a.app_icon_color, a.app_icon_image, 128)
      .then((u) => alive && setPreview(u))
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [a.app_icon, a.app_icon_color, a.app_icon_image]);
  const pick = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({ multiple: false, directory: false, filters: [{ name: t("ap.app_icon.filter"), extensions: ["png", "jpg", "jpeg"] }] });
    if (typeof file !== "string") return;
    setBusy(true);
    try {
      set({ app_icon: "custom", app_icon_image: await api.appIconImport(file) });
    } catch (e) {
      toast.error(e, t("ap.app_icon.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsCard title={t("ap.app_icon")}>
      {/* Vorschau in groß und in den echten Taskleisten-Größen, daneben die Motivwahl */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
        <div className="flex shrink-0 items-end gap-3">
          <span className="grid h-[72px] w-[72px] place-items-center rounded-card bg-field">
            {preview ? <img src={preview} alt={t("ap.app_icon")} className="h-14 w-14 [image-rendering:pixelated]" /> : <span className="h-14 w-14 rounded-ctl bg-surface2" />}
          </span>
          <span className="flex items-end gap-2 pb-0.5" aria-hidden>
            {preview
              ? [32, 24, 16].map((px) => <img key={px} src={preview} alt="" style={{ width: px, height: px }} className="[image-rendering:pixelated]" />)
              : [32, 24, 16].map((px) => <span key={px} style={{ width: px, height: px }} className="rounded-xs bg-surface2" />)}
          </span>
        </div>
        <p className="min-w-[220px] flex-1 text-[12.5px] leading-relaxed text-muted">{t("ap.app_icon.desc")}</p>
        <Segmented
          value={a.app_icon}
          onChange={(app_icon) => (app_icon === "custom" && !a.app_icon_image ? void pick() : set({ app_icon }))}
          items={[
            { value: "seal", label: t("ap.app_icon.seal") },
            { value: "penguin", label: t("ap.app_icon.penguin") },
            { value: "custom", label: t("ap.app_icon.custom") },
          ]}
        />
      </div>
      {a.app_icon === "custom" && (
        <SettingRow className="border-t" title={t("ap.app_icon.custom")} description={t("ap.app_icon.custom_hint")}>
          <Button size="sm" onClick={pick} loading={busy}>
            {a.app_icon_image ? t("ap.app_icon.change") : t("ap.app_icon.choose")}
          </Button>
        </SettingRow>
      )}
      <SettingRow className="border-t" title={t("ap.app_icon.color")} description={t("ap.app_icon.color.desc")} stacked>
        <AccentPicker value={a.app_icon_color} onChange={(app_icon_color, d) => set({ app_icon_color }, d)} />
      </SettingRow>
    </SettingsCard>
  );
}
