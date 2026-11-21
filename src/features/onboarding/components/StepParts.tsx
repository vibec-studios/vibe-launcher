import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Tag, cn } from "@/components/ui";

export function StepHead({ eyebrow, title, lead }: { eyebrow?: string; title: string; lead?: ReactNode }) {
  return (
    <div className="mb-8">
      {eyebrow && <div className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-brand">{eyebrow}</div>}
      <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-text">{title}</h1>
      {lead && <p className="mt-2 max-w-[620px] text-[14.5px] leading-relaxed text-muted">{lead}</p>}
    </div>
  );
}

/** Große Auswahlkarte (Radio). */
export function Choice({
  selected,
  onClick,
  title,
  text,
  icon,
  badge,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  text?: string;
  icon?: ReactNode;
  badge?: string;
  children?: ReactNode;
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "relative flex min-w-0 flex-col gap-3 rounded-panel bg-surface p-5 text-left transition-[background-color,box-shadow] duration-150",
        selected ? "bg-surface2 shadow-[inset_0_0_0_2px_var(--ui-accent)]" : "hover:bg-surface2",
      )}
    >
      {children}
      <div className="flex items-start gap-3">
        {icon && <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-card bg-bg", selected ? "text-brand" : "text-muted")}>{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold text-text">{title}</span>
            {badge && <Tag className="bg-brand/15 text-brand">{badge}</Tag>}
          </span>
          {text && <span className="mt-1 block text-[13px] leading-snug text-muted">{text}</span>}
        </span>
        <span
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-dot border-2 transition-colors",
            selected ? "border-brand bg-brand text-[var(--ui-on-accent)]" : "border-white/25",
          )}
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </span>
      </div>
    </button>
  );
}

export function Bullet({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-snug text-muted">
      <span className="mt-px shrink-0 text-dim">{icon}</span>
      <span>{children}</span>
    </li>
  );
}
