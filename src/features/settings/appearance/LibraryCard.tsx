import { LayoutGrid, List } from "lucide-react";
import { Segmented, SettingRow, SettingsCard } from "@/components/ui";
import { useT } from "@/i18n";
import type { CardProps } from "./types";

export function LibraryCard({ a, set }: CardProps) {
  const t = useT();
  return (
    <SettingsCard title={t("ap.section.library")}>
      <SettingRow title={t("ap.icon_size")} description={t("ap.icon_size.desc")}>
        <Segmented
          value={a.icon_size}
          onChange={(icon_size) => set({ icon_size })}
          items={(["large", "small"] as const).map((v) => ({ value: v, label: t(`ap.icon_size.${v}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("ap.library_view")} description={t("ap.library_view.desc")}>
        <Segmented
          value={a.library_view}
          onChange={(library_view) => {
            // sofort übernehmen (die Bibliothek merkt sich sonst die zuletzt umgeschaltete Ansicht)
            try {
              localStorage.setItem("vl.inst.view", JSON.stringify(library_view));
            } catch {
              /* egal */
            }
            set({ library_view });
          }}
          items={[
            { value: "grid", label: <span className="flex items-center gap-1.5"><LayoutGrid size={13} />{t("ap.library_view.grid")}</span> },
            { value: "list", label: <span className="flex items-center gap-1.5"><List size={13} />{t("ap.library_view.list")}</span> },
          ]}
        />
      </SettingRow>
    </SettingsCard>
  );
}
