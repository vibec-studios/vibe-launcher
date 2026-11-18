import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
}

/** Tab-Leiste: ruhige Labels, aktive Unterstreichung in Akzentfarbe. */
export function Tabs<V extends string>({
  value,
  onChange,
  items,
  className,
  right,
}: {
  value: V;
  onChange: (v: V) => void;
  items: TabItem<V>[];
  className?: string;
  right?: ReactNode;
}) {
  return (
    <div className={cn("flex h-11 items-stretch gap-1 border-b border-line", className)} role="tablist">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "flex items-center gap-2 px-3 text-[13.5px] font-semibold transition-colors duration-150",
              active ? "text-text shadow-[inset_0_-2px_0_var(--accent)]" : "text-muted hover:text-text",
            )}
          >
            {it.icon}
            {it.label}
            {it.badge !== undefined && it.badge !== null && (
              <span className="min-w-5 rounded-pill bg-white/[.08] px-1.5 text-center text-[11px] font-medium leading-5 text-muted">{it.badge}</span>
            )}
          </button>
        );
      })}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}

/** Segment-Umschalter (z. B. Modrinth | CurseForge). */
export function Segmented<V extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: V;
  onChange: (v: V) => void;
  items: { value: V; label: ReactNode; disabled?: boolean }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex gap-0.5 rounded-ctl bg-field p-0.5", className)} role="radiogroup">
      {items.map((it) => (
        <button
          key={it.value}
          role="radio"
          aria-checked={it.value === value}
          disabled={it.disabled}
          onClick={() => onChange(it.value)}
          className={cn(
            "h-7 rounded-[max(0px,calc(var(--r-ctl)-2px))] px-3 text-[13px] font-semibold transition-colors duration-150 disabled:opacity-40",
            it.value === value ? "bg-surface3 text-text shadow-e1" : "text-muted hover:text-text",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
