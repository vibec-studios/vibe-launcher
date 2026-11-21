// Ergebnis-Karten der Entdecken-Seite: Zeile (Liste) und Kachel (Raster, mit Galerie-Bild). Beide mit echtem
// Projekt-Icon, Kennzahlen, Kategorien als Symbole, Kompatibilität zur Ziel-Instanz und „Installieren“ mit Instanzwahl.
// memo: Fortschritt abonniert nur der Installieren-Knopf der Karte.
import { CalendarClock, Download, Heart } from "lucide-react";
import { memo } from "react";
import { ContextMenu, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatCount, formatDate, formatRelative } from "@/lib/format";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { ManualBadge } from "@/components/content/ManualBadge";
import { fmtNum } from "./categoryIcons";
import { InstallMenu } from "./InstallMenu";
import { CardMenu } from "./card/CardMenu";
import { CategoryTags, CompatNote, Stat, useOpenProps, type CardProps } from "./card/parts";

export { CategoryTags, hitColor, type CardProps } from "./card/parts";
export { Banner, ResultTile, TileSkeleton } from "./card/ResultTile";

/** Höhe einer Listenzeile bzw. einer Kachel (fest, für die Virtualisierung). */
export const ROW_H = 112;
export const TILE_H = 292;
/** Mindestbreite einer Kachel im Raster */
export const TILE_MIN_W = 250;

// ------------------------------------------------------------------ Zeile (Liste)

export const ResultRow = memo(function ResultRow({ hit, target, installed, instances, onOpen }: CardProps) {
  const t = useT();
  const { open, props } = useOpenProps(hit, onOpen);
  return (
    <ContextMenu content={<CardMenu hit={hit} instances={instances} onOpen={open} />}>
      <div
        {...props}
        className={cn(
          "group flex h-full cursor-pointer items-center gap-4 rounded-card px-3 transition-colors duration-100",
          "hover:bg-surface data-[state=open]:bg-surface focus-visible:bg-surface focus-visible:outline-none",
        )}
      >
        <ProjectIcon src={hit.icon_url} size={80} className="transition-transform duration-150 group-hover:-translate-y-px" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[15.5px] font-bold leading-tight tracking-[-0.005em] text-text">{hit.title}</span>
            <span className="shrink-0 truncate text-[12.5px] text-dim">{t("discover.by", { author: hit.author })}</span>
          </div>
          <p className="line-clamp-2 text-[13px] leading-[1.45] text-muted" title={hit.description}>
            {hit.description}
          </p>
          <div className="flex min-w-0 items-center gap-3">
            {hit.manual_download && <ManualBadge />}
            <CategoryTags hit={hit} />
            {target && <CompatNote hit={hit} target={target} installed={installed} />}
          </div>
        </div>
        <div className="flex w-[118px] shrink-0 flex-col items-end gap-1 text-[12.5px] text-muted max-[1100px]:hidden">
          <Stat icon={<Download size={13} />} tip={t("discover.downloads_n", { n: fmtNum(hit.downloads) })}>
            <span className="font-semibold text-text">{formatCount(hit.downloads)}</span>
          </Stat>
          {hit.source === "modrinth" && (
            <Stat icon={<Heart size={13} />} tip={t("discover.follows_n", { n: fmtNum(hit.follows) })}>
              {formatCount(hit.follows)}
            </Stat>
          )}
          {hit.updated && (
            <Stat icon={<CalendarClock size={13} />} tip={t("discover.updated_on", { date: formatDate(hit.updated) })}>
              {formatRelative(hit.updated)}
            </Stat>
          )}
        </div>
        <div className="flex min-w-[124px] shrink-0 justify-end">
          <InstallMenu project={hit} target={target} installed={installed} />
        </div>
      </div>
    </ContextMenu>
  );
});

export function RowSkeleton() {
  return (
    <div className="flex h-full items-center gap-4 px-3">
      <div className="skeleton h-20 w-20 shrink-0 rounded-card" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="skeleton h-4 w-2/5" />
        <div className="skeleton h-3 w-4/5" />
        <div className="skeleton h-3 w-3/5" />
        <div className="flex gap-2 pt-0.5">
          <div className="skeleton h-3.5 w-14" />
          <div className="skeleton h-3.5 w-20" />
          <div className="skeleton h-3.5 w-16" />
        </div>
      </div>
      <div className="flex w-[118px] flex-col items-end gap-2 max-[1100px]:hidden">
        <div className="skeleton h-3.5 w-14" />
        <div className="skeleton h-3.5 w-10" />
      </div>
      <div className="skeleton h-8 w-[110px] shrink-0" />
    </div>
  );
}
