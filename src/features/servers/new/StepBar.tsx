import { Fragment } from "react";
import { Check } from "lucide-react";
import { cn } from "@/components/ui";

export function StepBar({ steps, current, onJump }: { steps: string[]; current: number; onJump?: (i: number) => void }) {
  return (
    <ol className="flex min-w-0 items-center gap-2" aria-label={steps[current]}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Fragment key={label}>
            {i > 0 && <li aria-hidden className={cn("h-px min-w-3 flex-1", done || active ? "bg-brand/50" : "bg-line")} />}
            <li className="min-w-0 shrink">
              <button
                type="button"
                disabled={!done || !onJump}
                onClick={() => onJump?.(i)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-ctl px-1 py-0.5 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
                  active ? "text-text" : done ? "text-muted hover:text-text" : "text-dim",
                  done && onJump && "cursor-pointer",
                )}
              >
                <span
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-dot text-[12px] font-semibold tabular-nums",
                    active ? "bg-brand text-[var(--ui-on-accent)]" : done ? "bg-brand/20 text-brand" : "bg-surface2 text-dim",
                  )}
                >
                  {done ? <Check size={13} strokeWidth={3} /> : i + 1}
                </span>
                <span className="truncate">{label}</span>
              </button>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
