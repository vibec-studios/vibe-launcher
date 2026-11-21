import { ArrowLeft, Flame, LayoutGrid, List, X } from "lucide-react";
import { Select, Spinner, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Category, SortOrder } from "@/lib/types";
import { CategoryIcon, catIconKey, catLabel, fmtNum } from "../categoryIcons";
import { SORTS } from "../constants";
import { useDiscoverFilters, type ViewMode } from "../store";

/** Zeile über den Ergebnissen: Anzahl, aktive Filter als entfernbare Chips, Ansicht (Liste/Raster). */
export function ResultsBar({
  total,
  fetching,
  view,
  onView,
  canBrowse,
  onBrowse,
  cats,
}: {
  /** Kategorienliste (Namen der aktiven Kategorie-Filter) */
  cats?: Category[];
  total: number | null;
  fetching: boolean;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  canBrowse: boolean;
  onBrowse: () => void;
}) {
  const t = useT();
  const f = useDiscoverFilters();
  const chip = (key: string, icon: React.ReactNode, label: React.ReactNode, onRemove: () => void) => (
    <button
      key={key}
      onClick={onRemove}
      className="group inline-flex h-6 shrink-0 items-center gap-1.5 rounded-xs bg-white/[.06] pl-2 pr-1.5 text-[12px] font-medium text-text transition-colors hover:bg-white/[.1]"
      title={t("discover.filter.remove")}
    >
      {icon}
      {label}
      <X size={12} className="text-dim transition-colors group-hover:text-text" />
    </button>
  );
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-6">
      {canBrowse && (
        <button
          onClick={onBrowse}
          className="-ml-2 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-ctl px-2 text-[12.5px] font-semibold text-muted transition-colors hover:bg-white/[.06] hover:text-text"
        >
          <ArrowLeft size={13} />
          {t("discover.browse.back")}
        </button>
      )}
      <span className="shrink-0 text-meta tabular-nums text-dim">{total != null ? t("discover.results", { n: fmtNum(total) }) : ""}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {f.trending && chip("trending", <Flame size={12} className="text-warn" />, t("discover.browse.trending"), () => f.set({ trending: false }))}
        {f.categories.map((c) => {
          const cat = cats?.find((x) => x.id === c) ?? { id: c, name: c };
          return chip(c, <CategoryIcon id={catIconKey(cat)} size={12} className="text-dim" />, catLabel(cat), () => f.set({ categories: f.categories.filter((x) => x !== c) }));
        })}
        {fetching && <Spinner size={11} className="ml-1 text-brand" />}
      </div>
      <>
      <Tooltip content={t("discover.sort")}>
        <div className="w-[164px] shrink-0">
          <Select
            size="sm"
            variant="ghost"
            value={f.sort}
            onChange={(v: SortOrder) => f.set({ sort: v, trending: false })}
            options={SORTS.map((s) => ({ value: s, label: t(`discover.sort.${s}`) }))}
          />
        </div>
      </Tooltip>
      <div className="flex shrink-0 items-center gap-0.5" role="radiogroup" aria-label={t("discover.view")}>
        {(["list", "grid"] as const).map((v) => (
          <Tooltip key={v} content={t(`discover.view.${v}`)}>
            <button
              role="radio"
              aria-checked={view === v}
              aria-label={t(`discover.view.${v}`)}
              onClick={() => onView(v)}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-ctl transition-colors",
                view === v ? "bg-white/[.08] text-text" : "text-dim hover:bg-white/[.05] hover:text-text",
              )}
            >
              {v === "list" ? <List size={15} /> : <LayoutGrid size={14} />}
            </button>
          </Tooltip>
        ))}
      </div>
      </>
    </div>
  );
}
