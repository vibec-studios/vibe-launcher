import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import type { PreviewItem } from "../api";

/** Auswahl je Eintrag: "main" = das Projekt selbst, Zahl = Index der Alternative, null = nicht installieren */
export type Choice = "main" | number | null;
// Klick auf die Checkbox wird von der Zeile behandelt (sonst doppelt umgeschaltet)
export const noop = () => {};

export function initialChoice(it: PreviewItem): Choice {
  if (it.status === "install") return "main";
  if (it.status === "unavailable") {
    const i = it.alternatives.findIndex((a) => a.recommended);
    return i >= 0 ? i : null;
  }
  return null;
}

export function Row({ icon, title, meta, right, children, dim, onClick }: { icon: ReactNode; title: ReactNode; meta?: ReactNode; right?: ReactNode; children?: ReactNode; dim?: boolean; onClick?: () => void }) {
  return (
    <div className={cn("rounded-card border border-line bg-surface px-3 py-2.5", onClick && "cursor-pointer hover:bg-surface2")} onClick={onClick}>
      <div className="flex items-center gap-3">
        {icon}
        <div className={cn("min-w-0 flex-1", dim && "opacity-70")}>
          <div className="break-words text-[15px] font-semibold text-text">{title}</div>
          {meta && <div className="text-[13px] text-muted">{meta}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function SectionTitle({ icon, children, count }: { icon: ReactNode; children: ReactNode; count: number }) {
  return (
    <h2 className="flex items-center gap-2 pt-3 text-[16px] font-semibold text-text first:pt-0">
      {icon}
      {children}
      <span className="tabular-nums text-dim">{count}</span>
    </h2>
  );
}
