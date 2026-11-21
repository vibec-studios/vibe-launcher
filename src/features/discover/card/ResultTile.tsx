import { Download, Heart } from "lucide-react";
import { memo, useState, type CSSProperties } from "react";
import { ContextMenu, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatCount } from "@/lib/format";
import type { ProjectHit } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { ManualBadge } from "@/components/content/ManualBadge";
import { compatibility } from "@/components/content/util";
import { fmtNum } from "../categoryIcons";
import { InstallMenu } from "../InstallMenu";
import { CardMenu } from "./CardMenu";
import { CategoryTags, CompatNote, Stat, hitColor, useOpenProps, type CardProps } from "./parts";

// ------------------------------------------------------------------ Kachel (Raster)

/** Vorschaubild: Galerie-Bild, sonst flache Fläche in der (abgedunkelten) Projektfarbe. */
export function Banner({ hit, className, eager }: { hit: ProjectHit; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const color = hitColor(hit);
  const bg: CSSProperties = color ? { backgroundColor: `color-mix(in srgb, ${color} 22%, var(--surface-2))` } : {};
  return (
    <div className={cn("relative overflow-hidden bg-surface2", className)} style={bg}>
      {hit.banner_url && !failed ? (
        <img
          src={hit.banner_url}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-[var(--ease-snap)] group-hover:scale-[1.03]"
        />
      ) : !color && hit.icon_url ? (
        // Ohne Galerie-Bild und Markenfarbe: das Icon stark vergrößert und abgedunkelt als ruhige Farbfläche,
        // statt einer leeren grauen Box
        <img
          src={hit.icon_url}
          alt=""
          aria-hidden
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          className="absolute inset-0 h-full w-full scale-125 object-cover opacity-35 blur-2xl saturate-150"
        />
      ) : null}
    </div>
  );
}

export const ResultTile = memo(function ResultTile({ hit, target, installed, instances, onOpen }: CardProps) {
  const t = useT();
  const { open, props } = useOpenProps(hit, onOpen);
  return (
    <ContextMenu content={<CardMenu hit={hit} instances={instances} onOpen={open} />}>
      <div
        {...props}
        className={cn(
          "group flex h-full cursor-pointer flex-col overflow-hidden rounded-card bg-surface transition-colors duration-150",
          "hover:bg-surface2 data-[state=open]:bg-surface2 focus-visible:bg-surface2 focus-visible:outline-none",
        )}
      >
        <div className="relative shrink-0">
          <Banner hit={hit} className="h-[124px]" />
          {hit.manual_download && <ManualBadge solid className="absolute left-2 top-2" />}
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col px-3.5 pb-3">
          <div className="-mt-5 flex items-end gap-2.5">
            <span className="rounded-card bg-surface p-[3px] transition-colors duration-150 group-hover:bg-surface2">
              <ProjectIcon src={hit.icon_url} size={56} />
            </span>
            <div className="min-w-0 flex-1 pb-0.5">
              <div className="truncate text-[14.5px] font-bold leading-tight text-text">{hit.title}</div>
              <div className="truncate text-[12px] text-dim">{t("discover.by", { author: hit.author })}</div>
            </div>
          </div>
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-[1.45] text-muted" title={hit.description}>
            {hit.description}
          </p>
          <div className="mt-2">
            {target ? <CompatNote hit={hit} target={target} installed={installed} /> : null}
            {!target || hit.project_type === "modpack" || (!installed && compatibility(hit, target).ok) ? <CategoryTags hit={hit} max={4} iconsOnly /> : null}
          </div>
          <div className="mt-auto flex items-center gap-3 pt-2 text-[12px] text-muted">
            {/* Passt eine Kennzahl nicht mehr, rutscht sie in die (unsichtbare) zweite Zeile statt angeschnitten zu werden */}
            <div className="flex h-5 min-w-0 flex-wrap items-center gap-x-3 overflow-hidden">
              <Stat icon={<Download size={12} />} tip={t("discover.downloads_n", { n: fmtNum(hit.downloads) })}>
                {formatCount(hit.downloads)}
              </Stat>
              {hit.source === "modrinth" && (
                <Stat icon={<Heart size={12} />} tip={t("discover.follows_n", { n: fmtNum(hit.follows) })}>
                  {formatCount(hit.follows)}
                </Stat>
              )}
            </div>
            <div className="ml-auto shrink-0">
              <InstallMenu project={hit} target={target} installed={installed} />
            </div>
          </div>
        </div>
      </div>
    </ContextMenu>
  );
});

export function TileSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-card bg-surface">
      <div className="skeleton h-[124px] shrink-0 rounded-none" />
      <div className="flex flex-1 flex-col px-3.5 pb-3">
        <div className="-mt-5 flex items-end gap-2.5">
          <div className="rounded-card bg-surface p-[3px]">
            <div className="skeleton h-14 w-14" />
          </div>
          <div className="flex flex-1 flex-col gap-1.5 pb-1">
            <div className="skeleton h-3.5 w-3/5" />
            <div className="skeleton h-3 w-2/5" />
          </div>
        </div>
        <div className="skeleton mt-3 h-3 w-full" />
        <div className="skeleton mt-1.5 h-3 w-4/5" />
        <div className="mt-auto flex items-center gap-3">
          <div className="skeleton h-3 w-12" />
          <div className="skeleton h-3 w-10" />
          <div className="skeleton ml-auto h-8 w-24" />
        </div>
      </div>
    </div>
  );
}
