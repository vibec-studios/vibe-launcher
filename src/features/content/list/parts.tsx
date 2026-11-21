import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";

export function FilterChip({ active, onClick, count, tone, children }: { active: boolean; onClick: () => void; count?: number; tone?: "accent"; children: ReactNode }) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-pill px-2.5 text-[13px] font-semibold transition-colors duration-100",
        active ? (tone === "accent" ? "bg-accent text-[var(--on-accent)]" : "bg-surface3 text-text") : "bg-surface text-muted hover:bg-surface2 hover:text-text",
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn("text-[12px] font-medium tabular-nums", active ? "opacity-70" : tone === "accent" && count ? "text-accent" : "text-dim")}>{count}</span>
      )}
    </button>
  );
}

export function ColumnHead({ active, desc, onClick, children }: { active: boolean; desc: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      role="columnheader"
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
      onClick={onClick}
      className={cn("flex min-w-0 items-center gap-1 justify-self-start text-left transition-colors hover:text-text", active && "text-text")}
    >
      {children}
      {active && (desc ? <ChevronDown size={14} /> : <ChevronUp size={14} />)}
    </button>
  );
}

export function BarButton({ icon, children, onClick, disabled, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-35",
        danger ? "text-danger hover:bg-danger/10" : "text-text hover:bg-white/[.07]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
