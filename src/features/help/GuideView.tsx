import { Lightbulb } from "lucide-react";
import { useT } from "@/i18n";
import { guideById } from "./content/catalog";
import { useHelpContent } from "./content";
import { GuideIcon } from "./icons";
import { TourButton, TourStatus } from "./TourControls";
import type { GuideId } from "./types";
import { useSimple } from "@/lib/mode";
import { ExpertHint } from "@/features/simple/ExpertHint";

export function GuideView({ id }: { id: GuideId }) {
  const t = useT();
  const def = guideById(id);
  const g = useHelpContent().guides[id];
  const locked = useSimple() && !!def?.expert;
  if (!def || !g) return null;
  return (
    <article className="flex flex-col gap-4" data-testid={`guide-${id}`}>
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-brand/15 text-brand">
          <GuideIcon name={def.icon} size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-section text-text">{g.title}</h3>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{g.summary}</p>
        </div>
      </header>
      {locked && <ExpertHint text={t("usab.expert.guide")} />}
      {def.tour && !locked && (
        <div className="flex items-center gap-3 rounded-card bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
              {t("help.tour.offer")}
              <TourStatus id={def.tour} />
            </div>
            <div className="text-[12px] text-dim">{t("help.tour.offer.desc")}</div>
          </div>
          <TourButton id={def.tour} />
        </div>
      )}
      <ol className="flex flex-col gap-2.5">
        {g.steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-white/[.07] text-[12px] font-semibold tabular-nums text-muted">{i + 1}</span>
            <span className="pt-0.5 text-[13.5px] leading-relaxed text-text">{s}</span>
          </li>
        ))}
      </ol>
      {g.tips && g.tips.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-card bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-muted">
            <Lightbulb size={14} className="text-warn" />
            {t("help.tips")}
          </div>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-relaxed text-muted">
            {g.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
