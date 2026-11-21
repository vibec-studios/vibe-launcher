import { Checkbox, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { FixStep, LoaderKind } from "@/lib/types";
import { actionIcon, actionText, stepSub } from "./texts";

export function StepRow({
  s,
  on,
  alt,
  onToggle,
  onAlt,
  instLoader,
  inCause,
}: {
  s: FixStep;
  on: boolean;
  alt: boolean;
  onToggle: (v: boolean) => void;
  onAlt: (v: boolean) => void;
  instLoader?: LoaderKind;
  inCause?: boolean;
}) {
  const t = useT();
  const a = alt && s.alt ? s.alt : s.action;
  return (
    <div className={cn("flex items-start gap-3 rounded-ctl px-3 py-2.5 transition-colors duration-100", on ? "bg-surface2" : "bg-surface")}>
      <Checkbox checked={on} onChange={onToggle} label={actionText(a, t, s)} className="mt-[3px]" />
      <span className={cn("mt-[3px] shrink-0", on ? "text-accent" : "text-dim")}>{actionIcon(a)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-[13.5px] font-semibold", on ? "text-text" : "text-muted")}>{actionText(a, t, s)}</span>
          {s.confirm && <span className="shrink-0 rounded-xs bg-warn/15 px-1.5 py-px text-[11px] font-semibold text-warn">{t("fix.confirm_tag")}</span>}
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-dim">{stepSub(s, t, instLoader, inCause)}</div>
        {s.alt && (
          <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label={t("fix.alt_label")}>
            {[false, true].map((v) => (
              <button
                key={String(v)}
                role="radio"
                aria-checked={alt === v}
                onClick={() => {
                  onAlt(v);
                  onToggle(true);
                }}
                className={cn(
                  "h-7 rounded-ctl px-2.5 text-[12px] font-medium transition-colors duration-100",
                  alt === v ? "bg-white/[.1] text-text" : "text-muted hover:bg-white/[.05] hover:text-text",
                )}
              >
                {t("fix.do.disable", { name: v ? (s.alt_name ?? "") : s.name })}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
