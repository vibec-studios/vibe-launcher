import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Button, SettingRow, SettingsCard } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";
import { offerKey, openSettingsReview } from "./state";

// ------------------------------------------------------------------ Instanz-Einstellungen

/** „Einstellungen und Daten aus <Launcher> übernehmen“ – nur bei importierten Instanzen, deren Original noch da ist. */
export function ImportSettingsRow({ instance }: { instance: Instance }) {
  const t = useT();
  const q = useQuery({ queryKey: offerKey(instance.id), queryFn: () => api.importSettingsOffer(instance.id), staleTime: 60_000, retry: 0 });
  const o = q.data;
  if (!o) return null;
  const same = !o.changes.length && !o.data.length;
  const missing = o.data.filter((d) => d.missing_files > 0 && d.status !== "removed").length;
  const desc = same
    ? t("isx.row.same")
    : missing
      ? missing === 1
        ? t("isx.row.desc_data_1", { launcher: o.launcher_name })
        : t("isx.row.desc_data_n", { n: missing, launcher: o.launcher_name })
      : t("isx.row.desc");
  return (
    <SettingsCard title={t("isx.row.section")}>
      <SettingRow title={t("isx.row.title", { launcher: o.launcher_name })} description={desc}>
        {!same && (
          <Button size="sm" icon={<History size={13} />} onClick={() => openSettingsReview(instance.id)}>
            {t("isx.row.open")}
          </Button>
        )}
      </SettingRow>
    </SettingsCard>
  );
}
