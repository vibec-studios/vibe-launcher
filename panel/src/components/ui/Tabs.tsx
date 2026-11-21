import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  icon?: ReactNode;
}

export function Tabs<K extends string>({ items, value, onChange, className }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto border-b border-line", className)}>
      {items.map((it) => (
        <button
          key={it.key}
          role="tab"
          aria-selected={it.key === value}
          onClick={() => onChange(it.key)}
          className={cn(
            "-mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-[13.5px] font-medium transition-colors",
            it.key === value ? "border-brand text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<K extends string>({ items, value, onChange }: { items: { key: K; label: ReactNode }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-ctl bg-field p-0.5">
      {items.map((it) => (
        <button
          key={it.key}
          role="radio"
          aria-checked={it.key === value}
          onClick={() => onChange(it.key)}
          className={cn("h-8 rounded-ctl px-3 text-[13px] font-medium transition-colors", it.key === value ? "bg-surface3 text-text shadow-sm" : "text-muted hover:text-text")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
