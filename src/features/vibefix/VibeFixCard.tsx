import { useQuery } from "@tanstack/react-query";
import { BrainCircuit } from "lucide-react";
import { SettingRow, SettingsCard, Switch } from "@/components/ui";
import type { TabProps } from "@/features/settings/types";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

export function VibeFixCard({ s, update }: TabProps) {
  const t = useT();
  const on = s.vibefix ?? true;
  const status = useQuery({ queryKey: ["vibefix-status"], queryFn: api.vibefixStatus, staleTime: 30_000 });
  const st = status.data;
  const state = !on
    ? t("vibefix.setting.off")
    : st?.version
      ? t("vibefix.setting.ready", { version: st.version, date: st.checked_at ? formatDate(st.checked_at) : "–" })
      : t("vibefix.setting.pending");
  return (
    <SettingsCard title={t("vibefix.section")}>
      <SettingRow
        icon={<BrainCircuit size={18} className={on ? "text-accent" : "text-dim"} />}
        title={t("vibefix.setting")}
        description={
          <>
            {t("vibefix.setting.desc")}
            <span className="mt-1 block text-[11.5px] text-dim">{state}</span>
          </>
        }
      >
        <Switch checked={on} onChange={(vibefix) => update({ vibefix })} label={t("vibefix.setting")} />
      </SettingRow>
    </SettingsCard>
  );
}
