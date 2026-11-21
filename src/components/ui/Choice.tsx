import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "./cn";

export interface ChoiceCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  icon?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  badge?: ReactNode;
  selected?: boolean;
  arrow?: boolean;
}

export function ChoiceCard({ icon, title, text, badge, selected, arrow, className, ...rest }: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "vl-choice group relative flex min-h-[72px] w-full items-start gap-3.5 rounded-card border p-4 text-left transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-45",
        selected ? "border-accent/70 bg-accent/10" : "border-transparent bg-surface hover:bg-surface2",
        className,
      )}
      {...rest}
    >
      {icon && (
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-ctl", selected ? "bg-accent text-[var(--on-accent)]" : "bg-surface2 text-accent group-hover:bg-surface3")}>
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 text-[14.5px] font-semibold text-text">
          {title}
          {badge}
        </span>
        {text && <span className="text-[13px] leading-snug text-muted">{text}</span>}
      </span>
      {selected ? (
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-pill bg-accent text-[var(--on-accent)]">
          <Check size={13} strokeWidth={3} />
        </span>
      ) : (
        arrow && <ChevronRight size={18} className="mt-2.5 shrink-0 text-dim transition-colors group-hover:text-text" />
      )}
    </button>
  );
}

export function ChoiceGrid({ children, columns = 2, className }: { children: ReactNode; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <div
      className={cn(
        "grid gap-3",
        columns === 3 ? "grid-cols-[repeat(auto-fill,minmax(240px,1fr))]" : columns === 2 ? "grid-cols-[repeat(auto-fill,minmax(300px,1fr))]" : "grid-cols-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Steps({ steps, current, className }: { steps: ReactNode[]; current: number; className?: string }) {
  return (
    <ol className={cn("vl-steps flex min-w-0 items-center gap-2", className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={i} aria-current={active ? "step" : undefined} className={cn("flex min-w-0 items-center gap-2", i < steps.length - 1 && "flex-1")}>
            <span
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded-pill text-[12px] font-semibold tabular-nums",
                done ? "bg-accent/20 text-accent" : active ? "bg-accent text-[var(--on-accent)]" : "bg-surface2 text-dim",
              )}
            >
              {done ? <Check size={13} strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("truncate text-[13px] font-semibold", active ? "text-text" : "text-muted")}>{s}</span>
            {i < steps.length - 1 && <span className={cn("h-px min-w-4 flex-1", done ? "bg-accent/50" : "bg-line2")} />}
          </li>
        );
      })}
    </ol>
  );
}
