import type { ReactNode } from "react";
import { AnimatedNumber, Slider, Tooltip, cn } from "@/components/ui";

/** Farbfeld mit Farbwähler (Statusfarben). */
export function StatusSwatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Tooltip content={label}>
      <label className="relative grid h-8 w-8 cursor-pointer place-items-center rounded-ctl" style={{ background: value }}>
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </Tooltip>
  );
}

export function SliderValue({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-[260px] max-w-full items-center gap-3">
      <Slider value={value} min={min} max={max} step={step} disabled={disabled} onChange={onChange} />
      <span className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">
        <AnimatedNumber value={value} />
        {unit === "%" ? " %" : ` ${unit}`}
      </span>
    </div>
  );
}

export function PresetTile({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active} className="group flex w-[84px] flex-col items-center gap-1.5">
      <span
        className={cn(
          "relative h-[52px] w-full overflow-hidden rounded-card",
          active ? "outline outline-2 outline-offset-2 outline-brand" : "group-hover:outline group-hover:outline-1 group-hover:outline-offset-2 group-hover:outline-white/25",
        )}
      >
        {children}
      </span>
      <span className={cn("text-[12px] font-medium", active ? "text-text" : "text-muted group-hover:text-text")}>{label}</span>
    </button>
  );
}
