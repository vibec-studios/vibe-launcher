import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/components/ui";

export function ChoiceCard({
  icon,
  title,
  text,
  badge,
  selected,
  disabled,
  compact,
  onSelect,
}: {
  icon: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  badge?: ReactNode;
  selected: boolean;
  disabled?: boolean;
  compact?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "relative flex min-w-0 gap-3.5 rounded-card border text-left transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
        compact ? "px-3.5 py-3" : "px-4 py-4",
        text ? "items-start" : "items-center",
        selected ? "border-brand bg-brand/[.08]" : "border-line bg-surface hover:border-line2 hover:bg-surface2",
        disabled && "cursor-not-allowed opacity-50 hover:border-line hover:bg-surface",
      )}
    >
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-ctl",
          compact ? "h-9 w-9" : "h-11 w-11",
          selected ? "bg-brand/15 text-brand" : "bg-surface2 text-muted",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("font-semibold text-text", compact ? "text-[13.5px]" : "text-[14.5px]")}>{title}</span>
          {badge}
        </span>
        {text && <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">{text}</span>}
      </span>
      {selected && (
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-dot bg-brand text-[var(--ui-on-accent)]">
          <Check size={12} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
