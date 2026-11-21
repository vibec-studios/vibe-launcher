import type { ReactNode } from "react";
import { Checkbox, cn } from "@/components/ui";

/** Zeile mit Häkchen, Titel, Erklärung und optionalem Zusatz rechts. */
export function AreaRow({ on, disabled, title, desc, right, onChange, note }: { on: boolean; disabled?: boolean; title: string; desc: string; right?: ReactNode; note?: ReactNode; onChange: (v: boolean) => void }) {
  return (
    <div className={cn("flex items-start gap-3 border-line px-4 py-2.5 [&+&]:border-t", disabled && "opacity-55")}>
      <Checkbox checked={on} disabled={disabled} onChange={onChange} label={title} className="mt-[2px]" />
      <button type="button" disabled={disabled} onClick={() => onChange(!on)} className="min-w-0 flex-1 text-left disabled:cursor-default">
        <div className="text-[13.5px] font-medium text-text">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{desc}</div>
        {note}
      </button>
      {right && <div className="flex shrink-0 items-center gap-1.5 self-center">{right}</div>}
    </div>
  );
}
