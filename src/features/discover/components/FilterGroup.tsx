import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/components/ui";
import { useFilterGroups } from "../store";

/** Einklappbare Filtergruppe ohne Rahmen: ruhige Überschrift, Inhalt darunter. */
export function FilterGroup({
  id,
  title,
  children,
  right,
  count,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  /** Anzahl aktiver Filter der Gruppe */
  count?: number;
}) {
  const collapsed = useFilterGroups((s) => !!s.collapsed[id]);
  const toggle = useFilterGroups((s) => s.toggle);
  return (
    <section className="flex flex-col gap-1 pb-4">
      <div className="flex h-8 items-center gap-1">
        <button aria-expanded={!collapsed} onClick={() => toggle(id)} className="group flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-ctl px-2 text-left">
          <span className="truncate text-[12.5px] font-semibold text-muted group-hover:text-text">{title}</span>
          {!!count && <span className="grid h-4 min-w-4 place-items-center rounded-pill bg-brand/20 px-1 text-[10.5px] font-semibold text-brand">{count}</span>}
          <ChevronDown size={13} className={cn("ml-auto shrink-0 text-dim opacity-0 transition-[transform,opacity] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100", collapsed && "-rotate-90 opacity-100")} />
        </button>
        {!collapsed && right}
      </div>
      {!collapsed && children}
    </section>
  );
}

/** Kompakte Auswahlzeile ohne Kästchen: ausgewählt = hellere Schrift + Fläche + Haken rechts. */
export function CheckRow({ on, label, onClick, radio, icon }: { on: boolean; label: React.ReactNode; onClick: () => void; radio?: boolean; icon?: React.ReactNode }) {
  return (
    <button
      role={radio ? "radio" : "checkbox"}
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "flex h-7 w-full shrink-0 items-center gap-2 rounded-ctl px-2 text-left text-[13px] transition-colors duration-100",
        on ? "bg-white/[.06] text-text" : "text-muted hover:bg-white/[.04] hover:text-text",
      )}
    >
      {icon && <span className={cn("grid w-[14px] shrink-0 place-items-center [&>svg[shape-rendering]]:opacity-70", on ? "text-brand [&>svg[shape-rendering]]:opacity-100" : "text-dim")}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {on && <Check size={13} strokeWidth={2.5} className="shrink-0 text-brand" />}
    </button>
  );
}
