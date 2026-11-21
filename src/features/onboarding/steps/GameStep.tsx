import { CheckCircle2, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { openNewGame, openNewInstance } from "@/components/instance/actions";
import { instanceAccent } from "@/lib/format";
import { useInstances } from "@/lib/queries";
import type { UiMode } from "@/lib/mode";
import { GoalTiles } from "@/features/instances/simple/goals";
import { useT } from "@/i18n";
import { StepHead } from "../components/StepParts";

export function GameStep({ mode, onFinish }: { mode: UiMode; onFinish: (after?: () => void) => Promise<void> }) {
  const t = useT();
  const { data: instances = [] } = useInstances();
  if (instances.length > 0) {
    return (
      <>
        <StepHead
          eyebrow={t("onb.game.ready_eyebrow")}
          title={t("onb.game.ready_title")}
          lead={t(instances.length === 1 ? "onb.game.ready_lead_one" : "onb.game.ready_lead", { n: instances.length })}
        />
        {/* Die vorhandenen Spiele zeigen, statt nur eine Zahl zu nennen */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {instances.slice(0, 4).map((i) => (
            <span key={i.id} className="flex h-11 min-w-0 max-w-[220px] items-center gap-2.5 rounded-card bg-surface pl-1.5 pr-3.5">
              <InstanceIcon icon={i.icon} seed={i.id} accent={instanceAccent(i.id, i.accent)} size={32} />
              <span className="truncate text-[13.5px] font-semibold text-text">{i.name}</span>
            </span>
          ))}
          {instances.length > 4 && <span className="px-1 text-[13px] text-dim">{t("onb.game.ready_more", { n: instances.length - 4 })}</span>}
        </div>
        <div className="flex items-center gap-3 text-[14px] text-ok">
          <CheckCircle2 size={18} />
          {t("onb.game.ready_hint")}
        </div>
      </>
    );
  }
  return (
    <>
      <StepHead eyebrow={t("onb.game.eyebrow")} title={t("onb.game.title")} lead={mode === "simple" ? t("onb.game.lead_simple") : t("onb.game.lead_expert")} />
      {mode === "simple" ? (
        <GoalTiles compact onPick={(g) => void onFinish(() => openNewGame(g))} />
      ) : (
        <div className="flex items-center gap-4 rounded-panel bg-surface p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-bg text-brand">
            <LayoutGrid size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-text">{t("inst.new")}</div>
            <div className="text-[12.5px] text-muted">{t("onb.game.expert_text")}</div>
          </div>
          <Button variant="primary" onClick={() => void onFinish(openNewInstance)}>
            {t("onb.game.expert_cta")}
          </Button>
        </div>
      )}
      <p className="mt-6 text-[12.5px] text-dim">{t("onb.game.later")}</p>
    </>
  );
}
