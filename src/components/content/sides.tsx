// Client/Server-Einordnung: Tag + Filter (Inhalte-Tab, Modpack-Update-Vorschau, Import-Vorschau). OWNER: Content-Agent.
import { Monitor, MonitorSmartphone, Server, HelpCircle } from "lucide-react";
import { Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Side } from "@/lib/types";

export type SideFilter = "all" | Side;
export const SIDE_FILTERS: SideFilter[] = ["all", "client", "both", "server", "unknown"];

export function sideMatches(f: SideFilter, s: Side): boolean {
  return f === "all" || f === s;
}

const icons: Record<Side, React.ReactNode> = {
  client: <Monitor size={11} />,
  both: <MonitorSmartphone size={11} />,
  server: <Server size={11} />,
  unknown: <HelpCircle size={11} />,
};

/** Kleines Tag „Client“ / „Client & Server“ / „Server“ / „?“. */
export function SideTag({ side, className }: { side: Side; className?: string }) {
  const t = useT();
  return (
    <Tooltip content={t(`side.desc.${side}`)}>
      <span
        className={cn(
          "inline-flex h-[18px] shrink-0 items-center gap-1 border px-1.5 text-[11px] font-medium",
          side === "client" && "border-sky-400/30 text-sky-300",
          side === "server" && "border-amber-400/30 text-amber-300",
          side === "both" && "border-emerald-400/30 text-emerald-300",
          side === "unknown" && "border-line2 text-dim",
          className,
        )}
      >
        {icons[side]}
        {t(`side.short.${side}`)}
      </span>
    </Tooltip>
  );
}

/** Filterleiste (Chips mit Anzahl). */
export function SideFilterBar({ value, onChange, counts, className }: { value: SideFilter; onChange: (v: SideFilter) => void; counts?: Partial<Record<SideFilter, number>>; className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)} role="radiogroup" aria-label={t("side.filter")}>
      {SIDE_FILTERS.map((f) =>
        f !== "all" && counts && !counts[f] ? null : (
          <button
            key={f}
            role="radio"
            aria-checked={value === f}
            onClick={() => onChange(f)}
            className={cn(
              "flex h-7 items-center gap-1.5 px-2 text-[12.5px] font-medium transition-colors duration-100",
              value === f ? "bg-surface3 text-white" : "text-muted hover:bg-white/[.04] hover:text-white",
            )}
          >
            {t(`side.filter.${f}`)}
            {counts && <span className="text-[11.5px] text-dim">{counts[f] ?? 0}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export function countSides<T>(items: T[], side: (x: T) => Side): Partial<Record<SideFilter, number>> {
  const c: Partial<Record<SideFilter, number>> = { all: items.length };
  for (const i of items) {
    const s = side(i);
    c[s] = (c[s] ?? 0) + 1;
  }
  return c;
}
