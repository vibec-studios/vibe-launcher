import { X } from "lucide-react";
import { forwardRef, useEffect, useId, useRef } from "react";
import { Button, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Placement } from "./geometry";

interface Props {
  width: number;
  placement: Placement;
  tourTitle: string;
  title: string;
  text: string;
  missing: boolean;
  index: number;
  position: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

const ARROW: Record<Placement["side"], string> = {
  right: "-left-1.5",
  left: "-right-1.5",
  bottom: "-top-1.5",
  top: "-bottom-1.5",
  over: "hidden",
};

export const TourBubble = forwardRef<HTMLDivElement, Props>(function TourBubble(
  { width, placement, tourTitle, title, text, missing, index, position, total, onNext, onBack, onSkip },
  ref,
) {
  const t = useT();
  const id = useId();
  const primary = useRef<HTMLButtonElement>(null);
  const last = position === total - 1;
  const vertical = placement.side === "left" || placement.side === "right";

  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
  }, [index]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      data-testid="tour-bubble"
      className="vl-bubble absolute rounded-card bg-overlay p-4 shadow-e3"
      style={{ width, left: placement.left, top: placement.top }}
    >
      {placement.arrow !== null && (
        <span
          aria-hidden
          className={cn("absolute h-3 w-3 rotate-45 bg-overlay", ARROW[placement.side])}
          style={vertical ? { top: placement.arrow } : { left: placement.arrow }}
        />
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11.5px] font-semibold tabular-nums text-brand" aria-live="polite">
            {total > 1 ? `${tourTitle} · ${t("tour.count", { n: position + 1, total })}` : tourTitle}
          </div>
          <div id={`${id}-t`} className="mt-1 text-[15px] font-semibold text-text">
            {title}
          </div>
        </div>
        <button
          aria-label={t("help.tour.close")}
          onClick={onSkip}
          className="-mr-1.5 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-ctl text-dim hover:bg-white/[.07] hover:text-text"
        >
          <X size={15} />
        </button>
      </div>
      <p id={`${id}-d`} className="mt-1.5 text-[13px] leading-relaxed text-muted">
        {text}
      </p>
      {missing && (
        <p data-testid="tour-missing" className="mt-2 rounded-ctl bg-white/[.05] px-2.5 py-2 text-[12px] leading-snug text-dim">
          {t("help.tour.missing")}
        </p>
      )}
      <div className="mt-4 flex items-center gap-2">
        {!last && (
          <button onClick={onSkip} className="text-[12.5px] font-medium text-dim transition-colors hover:text-text">
            {t("tour.skip")}
          </button>
        )}
        <div className="flex-1" />
        {position > 0 && (
          <Button size="sm" variant="subtle" onClick={onBack}>
            {t("common.back")}
          </Button>
        )}
        <Button ref={primary} size="sm" variant="primary" data-testid="tour-next" onClick={onNext}>
          {last ? t("help.tour.finish") : t("onb.next")}
        </Button>
      </div>
    </div>
  );
});
