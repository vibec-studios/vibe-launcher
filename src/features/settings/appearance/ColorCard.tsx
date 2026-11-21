import { Pipette } from "lucide-react";
import { IconButton, Segmented, SettingRow, SettingsCard, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import { AccentPicker } from "./AccentPicker";
import { StatusSwatch } from "./controls";
import type { CardProps } from "./types";

export function ColorCard({ a, set }: CardProps) {
  const t = useT();
  return (
    <SettingsCard title={t("ap.section.color")}>
      <SettingRow title={t("ap.accent")} description={t("ap.accent.desc")} stacked>
        <AccentPicker value={a.accent} onChange={(accent, d) => set({ accent }, d)} />
      </SettingRow>
      <SettingRow title={t("ap.tone")} description={t("ap.tone.desc")}>
        <Segmented
          value={a.tone}
          onChange={(tone) => set({ tone })}
          items={(["light", "dark", "dim", "oled"] as const).map((v) => ({ value: v, label: t(`ap.tone.${v}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("ap.contrast")} description={t("ap.contrast.desc")}>
        <Segmented
          value={a.contrast}
          onChange={(contrast) => set({ contrast })}
          items={(["normal", "high"] as const).map((v) => ({ value: v, label: t(`ap.contrast.${v}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("ap.status")} description={t("ap.status.desc")}>
        <div className="flex items-center gap-2">
          {(["ok", "warn", "danger"] as const).map((k) => (
            <StatusSwatch key={k} label={t(`ap.status.${k}`)} value={a.status[k]} onChange={(v) => set({ status: { ...a.status, [k]: v } }, 250)} />
          ))}
          <Tooltip content={t("ap.status.from_accent")}>
            <IconButton
              label={t("ap.status.from_accent")}
              size="sm"
              variant="ghost"
              onClick={() => set({ status: { ...a.status, ok: a.accent } })}
            >
              <Pipette size={14} />
            </IconButton>
          </Tooltip>
        </div>
      </SettingRow>
    </SettingsCard>
  );
}
