// Ergebnis-Karten der Entdecken-Seite: Zeile (Liste) und Kachel (Raster, mit Galerie-Bild). Beide mit echtem
// Projekt-Icon, Kennzahlen, Kategorien als Symbole, Kompatibilität zur Ziel-Instanz und „Installieren“ mit Instanzwahl.
// memo: Fortschritt abonniert nur der Installieren-Knopf der Karte.
import { AlertTriangle, CalendarClock, Check, Copy, Download, ExternalLink, FolderPlus, Heart, PackagePlus, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { memo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ContextItem, ContextLabel, ContextMenu, ContextSeparator, ContextSub, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { formatCount, formatDate, formatLoader, formatRelative } from "@/lib/format";
import type { Instance, ProjectHit } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { prettyLoader } from "@/components/content/Pill";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { openInstall } from "@/components/content/InstallDialog";
import { startContentInstall } from "@/components/content/install";
import { compatibility, copyText, openExternal, projectWebUrl } from "@/components/content/util";
import { CategoryIcon, categoryLabel } from "./categoryIcons";
import { InstallMenu } from "./InstallMenu";

/** Höhe einer Listenzeile bzw. einer Kachel (fest, für die Virtualisierung). */
export const ROW_H = 112;
export const TILE_H = 286;
/** Mindestbreite einer Kachel im Raster */
export const TILE_MIN_W = 250;

export interface CardProps {
  hit: ProjectHit;
  /** Ziel-Instanz-Modus */
  target: Instance | null;
  installed: boolean;
  instances: Instance[];
  onOpen: (hit: ProjectHit) => void;
}

const LOADERS = ["fabric", "forge", "neoforge", "quilt"];

function loadersOf(hit: ProjectHit) {
  return hit.project_type === "mod" || hit.project_type === "modpack" ? hit.loaders.filter((l) => LOADERS.includes(l)) : [];
}

/** Markenfarbe als CSS-Farbe (flach, ohne Verlauf). */
export function hitColor(hit: Pick<ProjectHit, "color">): string | null {
  return hit.color != null ? `#${hit.color.toString(16).padStart(6, "0")}` : null;
}

function CardMenu({ hit, instances, onOpen }: { hit: ProjectHit; instances: Instance[]; onOpen: () => void }) {
  const t = useT();
  const url = projectWebUrl(hit);
  const sorted = hit.project_type === "modpack" ? [] : instances.map((i) => ({ i, ok: compatibility(hit, i).ok })).sort((a, b) => Number(b.ok) - Number(a.ok)).slice(0, 14);
  return (
    <>
      <ContextItem icon={<SquareArrowOutUpRight size={14} />} onSelect={onOpen}>
        {t("discover.menu.open")}
      </ContextItem>
      {hit.project_type === "modpack" ? (
        <ContextItem icon={<FolderPlus size={14} />} onSelect={() => openInstall({ project: hit })}>
          {t("install.as_new_instance")}
        </ContextItem>
      ) : (
        <ContextSub icon={<PackagePlus size={14} />} label={t("discover.menu.install_in")}>
          {sorted.length === 0 && <ContextLabel>{t("install.no_instances")}</ContextLabel>}
          {sorted.map(({ i, ok }) => (
            <ContextItem
              key={i.id}
              icon={<InstanceBadge instance={i} size={14} />}
              onSelect={() => startContentInstall(i.id, hit, null).catch((e) => toast.error(t("install.failed", { name: hit.title }), errorMessage(e)))}
            >
              <span className={ok ? undefined : "text-dim"}>{i.name}</span>
            </ContextItem>
          ))}
          <ContextSeparator />
          <ContextItem icon={<RefreshCw size={14} />} onSelect={() => openInstall({ project: hit })}>
            {t("discover.menu.choose")}
          </ContextItem>
        </ContextSub>
      )}
      {url && (
        <>
          <ContextSeparator />
          <ContextItem icon={<ExternalLink size={14} />} onSelect={() => void openExternal(url)}>
            {t("discover.menu.browser")}
          </ContextItem>
          <ContextItem
            icon={<Copy size={14} />}
            onSelect={() =>
              copyText(url)
                .then(() => toast.success(t("common.copied"), url))
                .catch((e) => toast.error(e))
            }
          >
            {t("discover.menu.copy_link")}
          </ContextItem>
        </>
      )}
    </>
  );
}

/** Kategorien als kleine Symbol-Etiketten (Symbol + Name), ruhig und einzeilig. */
export function CategoryTags({ hit, max = 3, iconsOnly }: { hit: ProjectHit; max?: number; iconsOnly?: boolean }) {
  const loaders = loadersOf(hit);
  return (
    <div className="flex min-w-0 items-center gap-x-2.5 gap-y-1 overflow-hidden text-[12px] text-muted">
      {loaders.length > 0 && <span className="shrink-0 font-medium text-text/90">{loaders.map(prettyLoader).join(" · ")}</span>}
      {hit.categories.slice(0, max).map((c) =>
        iconsOnly ? (
          <Tooltip key={c} content={categoryLabel(c)}>
            <span className="grid h-5 w-5 shrink-0 place-items-center text-dim">
              <CategoryIcon id={c} />
            </span>
          </Tooltip>
        ) : (
          <span key={c} className="flex shrink-0 items-center gap-1">
            <CategoryIcon id={c} className="text-dim" />
            {categoryLabel(c)}
          </span>
        ),
      )}
    </div>
  );
}

/** Passt das Projekt zur gewählten Instanz? (nur im Ziel-Instanz-Modus) */
function CompatNote({ hit, target, installed }: { hit: ProjectHit; target: Instance; installed: boolean }) {
  const t = useT();
  if (hit.project_type === "modpack") return null;
  if (installed)
    return (
      <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-ok">
        <Check size={12} strokeWidth={2.5} />
        {t("discover.in_instance", { name: target.name })}
      </span>
    );
  const c = compatibility(hit, target);
  if (c.ok) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-[12px] text-warn">
      <AlertTriangle size={12} />
      {c.reason === "vanilla"
        ? t("install.incompat.vanilla")
        : c.reason === "loader"
          ? t("install.incompat.loader", { loader: formatLoader(target.loader) })
          : t("install.incompat.version", { version: target.mc_version })}
    </span>
  );
}

function Stat({ icon, children, tip }: { icon: ReactNode; children: ReactNode; tip?: ReactNode }) {
  const el = (
    <span className="flex items-center gap-1.5 tabular-nums">
      <span className="text-dim">{icon}</span>
      {children}
    </span>
  );
  return tip ? <Tooltip content={tip}>{el}</Tooltip> : el;
}

function useOpenProps(hit: ProjectHit, onOpen: (h: ProjectHit) => void) {
  const open = () => onOpen(hit);
  return {
    open,
    props: {
      role: "link",
      tabIndex: 0,
      onClick: open,
      onKeyDown: (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && open(),
    },
  };
}

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
            <CategoryTags hit={hit} />
            {target && <CompatNote hit={hit} target={target} installed={installed} />}
          </div>
        </div>
        <div className="flex w-[118px] shrink-0 flex-col items-end gap-1 text-[12.5px] text-muted max-[1100px]:hidden">
          <Stat icon={<Download size={13} />} tip={t("discover.downloads_n", { n: hit.downloads.toLocaleString() })}>
            <span className="font-semibold text-text">{formatCount(hit.downloads)}</span>
          </Stat>
          {hit.source === "modrinth" && (
            <Stat icon={<Heart size={13} />} tip={t("discover.follows_n", { n: hit.follows.toLocaleString() })}>
              {formatCount(hit.follows)}
            </Stat>
          )}
          {hit.updated && (
            <Stat icon={<CalendarClock size={13} />} tip={t("discover.updated_on", { date: formatDate(hit.updated) })}>
              {formatRelative(hit.updated)}
            </Stat>
          )}
        </div>
        <div className="flex w-[124px] shrink-0 justify-end">
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
        <Banner hit={hit} className="h-[124px] shrink-0" />
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
            <Stat icon={<Download size={12} />} tip={t("discover.downloads_n", { n: hit.downloads.toLocaleString() })}>
              {formatCount(hit.downloads)}
            </Stat>
            {hit.source === "modrinth" && (
              <Stat icon={<Heart size={12} />} tip={t("discover.follows_n", { n: hit.follows.toLocaleString() })}>
                {formatCount(hit.follows)}
              </Stat>
            )}
            <div className="ml-auto">
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
