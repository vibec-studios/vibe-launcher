import { Cloud, CloudOff, Link2, Server as ServerIcon, Users } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "@/components/ui";
import { useSettings } from "@/lib/queries";
import { patchSettings } from "@/lib/mode";
import { joinWaitlist } from "@/features/access/actions";
import { useKnownApproved } from "@/features/access/hooks";
import { useVibeAccess } from "@/features/access/store";
import { useT } from "@/i18n";
import { Choice, StepHead } from "../components/StepParts";

export function VibeStep() {
  const t = useT();
  const s = useSettings().data;
  const on = !!s?.vibe.enabled;
  const set = (enabled: boolean) => s && patchSettings({ vibe: { ...s.vibe, enabled } }).catch((e) => toast.error(e));
  const knownOk = useKnownApproved();
  const join = useRef(false);
  join.current = on && !knownOk;
  useEffect(
    () => () => {
      const st = useVibeAccess.getState().status;
      if (join.current && st !== "waitlist" && st !== "approved") joinWaitlist().catch(() => {});
    },
    [],
  );
  return (
    <>
      <StepHead
        eyebrow={`${t("onb.vibe.eyebrow")} · ${t("access.beta")}`}
        title={t("onb.vibe.title")}
        lead={knownOk ? t("onb.vibe.lead") : t("onb.vibe.beta_lead")}
      />
      <ul className="mb-6 grid grid-cols-3 gap-3">
        {(
          [
            [<Users size={18} key="u" />, "friends"],
            [<ServerIcon size={18} key="s" />, "hosting"],
            [<Link2 size={18} key="l" />, "links"],
          ] as const
        ).map(([icon, k]) => (
          <li key={k} className="flex flex-col gap-2 rounded-card bg-surface p-4">
            <span className="text-brand">{icon}</span>
            <span className="text-[14px] font-semibold text-text">{t(`onb.vibe.${k}`)}</span>
            <span className="text-[12.5px] leading-snug text-muted">{t(`onb.vibe.${k}.desc`)}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label={t("onb.vibe.title")}>
        <Choice
          selected={on}
          onClick={() => set(true)}
          title={knownOk ? t("onb.vibe.on") : t("onb.vibe.join")}
          text={knownOk ? t("onb.vibe.on.text") : t("onb.vibe.join.text")}
          icon={<Cloud size={18} />}
        />
        <Choice selected={!on} onClick={() => set(false)} title={t("onb.vibe.off")} text={t("onb.vibe.off.text")} icon={<CloudOff size={18} />} />
      </div>
    </>
  );
}
