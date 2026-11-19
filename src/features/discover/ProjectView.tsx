// Projektansicht (nach dem Vorbild von Modrinth): Kopf mit Icon, Name, Autor, Kennzahlen, Loader/Versionen und
// auffälligem Installieren-Knopf, Reiter Beschreibung / Galerie / Versionen, rechts eine Seitenleiste mit Details.
// Wird im Overlay über „Entdecken“ und im Server-Plugin-Overlay genutzt (Installieren-Knopf kommt als Slot).
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Bug, CalendarClock, Check, Code2, Copy, Download, ExternalLink, Globe, Heart, Images, MessageCircle, MoreHorizontal, Scale, Star } from "lucide-react";
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { DropdownItem, DropdownMenu, DropdownSeparator, IconButton, Skeleton, Tabs, Tooltip, cn, toast } from "@/components/ui";
import { Lightbox } from "@/components/ui/Lightbox";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatCount, formatDate, formatLoader, formatRelative } from "@/lib/format";
import { qk } from "@/lib/queries";
import type { Dependency, Instance, ProjectDetails, Source } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { RichText } from "@/components/content/RichText";
import { Pill, prettyLoader } from "@/components/content/Pill";
import { ManualBadge } from "@/components/content/ManualBadge";
import { compareMc, compatibility, contentKindOf, copyText, openExternal, versionRange } from "@/components/content/util";
import { CategoryIcon, categoryLabel, fmtNum } from "./categoryIcons";
import { hitColor } from "./ResultCard";
import { VersionsTab } from "./VersionsTab";

/** Quelle der Ansicht: Inhalte-Quellen plus Hangar (Server-Plugins). */
export type ViewSource = Source | "hangar";
/** Projektdaten der Ansicht (Hangar liefert dasselbe Format). */
export type ViewProject = Omit<ProjectDetails, "source" | "project_type"> & { source: ViewSource; project_type: ProjectDetails["project_type"] | "plugin" };

type Tab = "description" | "gallery" | "versions";

const MODRINTH_LINK = /^https?:\/\/(?:www\.)?modrinth\.com\/(?:mod|plugin|resourcepack|shader|datapack|modpack|project)\/([\w.-]+)\/?(?:[?#].*)?$/i;

function viewSourceName(s: ViewSource): string {
  if (s === "modrinth") return "Modrinth";
  if (s === "curseforge") return "CurseForge";
  if (s === "hangar") return "Hangar";
  return s.replace(/^store:/, "");
}

function linkList(p: ViewProject, t: ReturnType<typeof useT>) {
  const l = p.links;
  return [
    l.website && { key: "website", href: l.website, icon: <Globe size={15} />, label: t("project.link.website") },
    l.source && { key: "source", href: l.source, icon: <Code2 size={15} />, label: t("project.link.source") },
    l.issues && { key: "issues", href: l.issues, icon: <Bug size={15} />, label: t("project.link.issues") },
    l.wiki && { key: "wiki", href: l.wiki, icon: <BookOpen size={15} />, label: t("project.link.wiki") },
    l.discord && { key: "discord", href: l.discord, icon: <MessageCircle size={15} />, label: "Discord" },
  ].filter(Boolean) as { key: string; href: string; icon: ReactNode; label: string }[];
}

export interface ProjectViewProps {
  p: ViewProject;
  /** Ziel-Instanz (Kompatibilität, Versionen vorfiltern) */
  target: Instance | null;
  /** Installieren-Knopf (mit Zielwahl) */
  install: ReactNode;
  /** Anderes Projekt in derselben Ansicht öffnen (Abhängigkeiten, Modrinth-Links in der Beschreibung) */
  onOpenProject?: (source: Source, id: string) => void;
  /** Versionen-Reiter (Installieren bestimmter Versionen in Instanzen) */
  versions?: boolean;
  /** Abhängigkeiten in der Seitenleiste (nur Modrinth/CurseForge/Stores) */
  deps?: boolean;
  /** Zusätzlicher Hinweis oben in der Seitenleiste */
  sideNote?: ReactNode;
}

export function ProjectView({ p, target, install, onOpenProject, versions = true, deps, sideNote }: ProjectViewProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("description");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const images = useMemo(() => [...p.gallery].sort((a, b) => Number(b.featured) - Number(a.featured)), [p]);
  const manual = !!p.manual_download && p.project_type !== "modpack";

  // Links auf andere Modrinth-Projekte in der Beschreibung im Overlay öffnen statt im Browser
  const onDescClick = (e: MouseEvent) => {
    if (!onOpenProject) return;
    const a = (e.target as HTMLElement).closest?.("a");
    const m = a && MODRINTH_LINK.exec(a.getAttribute("href") ?? "");
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    onOpenProject("modrinth", m[1]);
  };

  return (
    <div className="@container">
      <Header p={p} install={install} banner={images[0]?.url ?? null} onBanner={() => setLightbox(0)} />
      {manual && (
        <div className="mt-4 flex items-start gap-2.5 rounded-card bg-warn/[.08] px-3.5 py-3 @min-[880px]:hidden">
          <ManualBadge iconOnly className="mt-px" />
          <div className="min-w-0 text-[12.5px] leading-snug">
            <span className="font-semibold text-text">{t("manual.badge")}</span> <span className="text-muted">{t("manual.tip")}</span>
          </div>
        </div>
      )}
      <div className="sticky top-0 z-10 mt-4 bg-panel">
        <Tabs
          value={tab}
          onChange={setTab}
          className="-mx-3 h-11"
          items={[
            { value: "description", label: t("project.tab.description") },
            { value: "gallery", label: t("project.tab.gallery"), badge: p.gallery.length || undefined },
            ...(versions ? [{ value: "versions" as Tab, label: t("project.tab.versions") }] : []),
          ]}
        />
      </div>
      <div className="flex items-start gap-8 pt-6">
        <div className="min-w-0 flex-1" onClickCapture={onDescClick}>
          {tab === "description" && <Description p={p} />}
          {tab === "gallery" && <Gallery images={images} onOpen={setLightbox} />}
          {tab === "versions" && versions && <VersionsTab project={p as ProjectDetails} instanceId={target?.id} />}
        </div>
        {tab !== "versions" && <InfoSidebar p={p} target={target} deps={deps ?? versions} onOpenProject={onOpenProject} note={sideNote} />}
      </div>
      <Lightbox
        images={images}
        index={lightbox}
        onIndexChange={setLightbox}
        onClose={() => setLightbox(null)}
        labels={{ prev: t("project.prev"), next: t("project.next"), close: t("common.close") }}
      />
    </div>
  );
}

function Header({ p, install, banner, onBanner }: { p: ViewProject; install: ReactNode; banner: string | null; onBanner: () => void }) {
  const t = useT();
  const [bannerFailed, setBannerFailed] = useState(false);
  const loaders = p.loaders.filter((l) => l !== "minecraft" && (p.project_type === "plugin" || ["fabric", "forge", "neoforge", "quilt"].includes(l)));
  const range = versionRange(p.game_versions);
  const links = linkList(p, t);
  const color = hitColor(p);
  const showBanner = !!banner && !bannerFailed;

  return (
    <div className="animate-fade-in">
      {showBanner ? (
        <button
          onClick={onBanner}
          aria-label={t("project.tab.gallery")}
          className="group relative block h-[clamp(112px,22vh,180px)] w-full overflow-hidden rounded-card bg-surface2 @max-[760px]:h-[clamp(100px,18vh,140px)]"
        >
          <img
            src={banner!}
            alt=""
            draggable={false}
            onError={() => setBannerFailed(true)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-[var(--ease-snap)] group-hover:scale-[1.015]"
          />
          {p.gallery.length > 1 && (
            <span className="absolute bottom-3 right-3 inline-flex h-7 items-center gap-1.5 rounded-ctl bg-black/70 px-2.5 text-[12px] font-semibold text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <Images size={13} />
              {t("project.gallery_more", { n: p.gallery.length })}
            </span>
          )}
        </button>
      ) : (
        color && <div className="h-1.5 w-full rounded-pill" style={{ backgroundColor: color }} />
      )}
      <div className={cn("flex items-start gap-5", showBanner ? "-mt-9 px-5" : "mt-4")}>
        <span className={cn("shrink-0 rounded-card", showBanner && "bg-panel p-1")}>
          <ProjectIcon src={p.icon_url} size={96} eager />
        </span>
        <div className={cn("flex min-w-0 flex-1 flex-col gap-1", showBanner ? "pt-11" : "pt-1")}>
          <h1 className="selectable truncate text-[26px] font-bold leading-tight tracking-[-0.02em] text-text" title={p.title}>
            {p.title}
          </h1>
          {p.author && <span className="truncate text-[13px] text-muted">{t("discover.by", { author: p.author })}</span>}
          <p className="selectable mt-1 line-clamp-2 max-w-[720px] text-[14px] leading-snug text-muted" title={p.description}>
            {p.description}
          </p>
        </div>
      </div>
      <div className={cn("mt-4 flex flex-wrap items-center gap-x-5 gap-y-3", showBanner && "px-5")}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted">
          {p.manual_download && <ManualBadge />}
          <Tooltip content={t("discover.downloads_n", { n: fmtNum(p.downloads) })}>
            <span className="flex items-center gap-1.5">
              <Download size={14} className="text-dim" />
              <b className="font-semibold tabular-nums text-text">{formatCount(p.downloads)}</b> {t("project.downloads_lc")}
            </span>
          </Tooltip>
          {(p.source === "modrinth" || p.source === "hangar") && (
            <Tooltip content={p.source === "hangar" ? t("project.stars_n", { n: fmtNum(p.follows) }) : t("discover.follows_n", { n: fmtNum(p.follows) })}>
              <span className="flex items-center gap-1.5">
                {p.source === "hangar" ? <Star size={14} className="text-dim" /> : <Heart size={14} className="text-dim" />}
                <b className="font-semibold tabular-nums text-text">{formatCount(p.follows)}</b> {p.source === "hangar" ? t("project.stars_lc") : t("project.follows_lc")}
              </span>
            </Tooltip>
          )}
          {p.updated && (
            <Tooltip content={formatDate(p.updated)}>
              <span className="flex items-center gap-1.5">
                <CalendarClock size={14} className="text-dim" />
                {t("project.updated_ago", { time: formatRelative(p.updated) })}
              </span>
            </Tooltip>
          )}
          {(loaders.length > 0 || range) && (
            <span className="flex flex-wrap items-center gap-1.5">
              {loaders.slice(0, 5).map((l) => (
                <Pill key={l} className="text-text">
                  {prettyLoader(l)}
                </Pill>
              ))}
              {range && <Pill className="font-mono text-[11.5px] text-text">{range}</Pill>}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {install}
          {links.slice(0, 2).map((l) => (
            <IconButton key={l.key} label={l.label} tip variant="ghost" onClick={() => void openExternal(l.href)}>
              {l.icon}
            </IconButton>
          ))}
          <DropdownMenu
            trigger={
              <IconButton label={t("common.more")} tip variant="ghost">
                <MoreHorizontal size={16} />
              </IconButton>
            }
          >
            {links.length > 2 && (
              <>
                {links.slice(2).map((l) => (
                  <DropdownItem key={l.key} icon={l.icon} onSelect={() => void openExternal(l.href)}>
                    {l.label}
                  </DropdownItem>
                ))}
                <DropdownSeparator />
              </>
            )}
            <DropdownItem icon={<ExternalLink size={14} />} onSelect={() => void openExternal(p.page_url)}>
              {t("project.open_on", { source: viewSourceName(p.source) })}
            </DropdownItem>
            <DropdownItem
              icon={<Copy size={14} />}
              onSelect={() =>
                copyText(p.page_url)
                  .then(() => toast.success(t("common.copied"), p.page_url))
                  .catch((e) => toast.error(e))
              }
            >
              {t("discover.menu.copy_link")}
            </DropdownItem>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export function ProjectViewSkeleton() {
  return (
    <div>
      <Skeleton className="h-[180px] w-full rounded-card" />
      <div className="-mt-9 flex items-start gap-5 px-5">
        <div className="rounded-card bg-panel p-1">
          <Skeleton className="h-[96px] w-[96px] rounded-card" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-11">
          <Skeleton className="h-7 w-2/5" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-5 px-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-36" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-[150px]" />
      </div>
      <div className="mt-10 flex gap-8">
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-3 h-48 w-full rounded-card" />
        </div>
        <div className="flex w-[248px] shrink-0 flex-col gap-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-16" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24" />
        </div>
      </div>
    </div>
  );
}

function SideSection({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-text">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function SideLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      onClick={() => void openExternal(href)}
      className="group -mx-2 flex h-8 items-center gap-2.5 rounded-ctl px-2 text-left text-[13px] text-muted transition-colors hover:bg-white/[.05] hover:text-text"
    >
      <span className="text-dim transition-colors group-hover:text-text">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      <ExternalLink size={12} className="text-dim opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/** Passt das Projekt zur Ziel-Instanz? */
function TargetFit({ p, target }: { p: ProjectDetails; target: Instance }) {
  const t = useT();
  const kind = contentKindOf(p.project_type);
  const installedQ = useQuery({
    queryKey: qk.content(target.id, kind ?? "mod"),
    queryFn: () => api.contentList(target.id, kind!),
    enabled: !!kind,
  });
  if (p.project_type === "modpack") return null;
  const installed = installedQ.data?.some((c) => c.project_id === p.id);
  const c = compatibility(p, target);
  return (
    <div className={cn("flex items-start gap-2.5 rounded-card px-3.5 py-3", installed || c.ok ? "bg-ok/[.08]" : "bg-warn/[.08]")}>
      {installed || c.ok ? <Check size={15} strokeWidth={2.5} className="mt-px shrink-0 text-ok" /> : <AlertTriangle size={15} className="mt-px shrink-0 text-warn" />}
      <div className="min-w-0 text-[12.5px] leading-snug">
        <div className="font-semibold text-text">
          {installed ? t("discover.in_instance", { name: target.name }) : c.ok ? t("project.compat.ok", { name: target.name }) : t("project.compat.no", { name: target.name })}
        </div>
        <div className="text-muted">{`${target.mc_version} · ${formatLoader(target.loader)}`}</div>
      </div>
    </div>
  );
}

const DEP_ORDER: Record<string, number> = { required: 0, optional: 1, incompatible: 2, embedded: 3 };

/** Abhängigkeiten der neuesten (zur Ziel-Instanz passenden) Version; Klick öffnet sie in derselben Ansicht. */
function Dependencies({ p, target, onOpenProject }: { p: ProjectDetails; target: Instance | null; onOpenProject?: (s: Source, id: string) => void }) {
  const t = useT();
  const vq = useQuery({
    queryKey: qk.versions(p.source, p.id, null, null),
    queryFn: () => api.contentVersions(p.source, p.id, null, null),
    staleTime: 5 * 60_000,
  });
  const version = useMemo(() => {
    const all = vq.data ?? [];
    if (!target) return all[0];
    return all.find((v) => v.game_versions.includes(target.mc_version) && (!v.loaders.length || v.loaders.includes(target.loader.kind))) ?? all[0];
  }, [vq.data, target]);
  const deps = useMemo(
    () =>
      (version?.dependencies ?? [])
        .filter((d): d is Dependency & { project_id: string } => !!d.project_id && d.kind !== "embedded")
        .filter((d, i, a) => a.findIndex((x) => x.project_id === d.project_id) === i)
        .sort((a, b) => DEP_ORDER[a.kind] - DEP_ORDER[b.kind])
        .slice(0, 8),
    [version],
  );
  const projects = useQueries({
    queries: deps.map((d) => ({
      queryKey: qk.project(d.source ?? p.source, d.project_id),
      queryFn: () => api.contentProject(d.source ?? p.source, d.project_id),
      staleTime: 10 * 60_000,
      retry: 0,
    })),
  });
  if (vq.isPending)
    return (
      <SideSection title={t("project.deps")}>
        <Skeleton className="h-10" />
      </SideSection>
    );
  if (!deps.length) return null;
  return (
    <SideSection title={t("project.deps")}>
      <div className="-mx-2 flex flex-col">
        {deps.map((d, i) => {
          const dp = projects[i]?.data;
          const src = d.source ?? p.source;
          return (
            <button
              key={d.project_id}
              onClick={() => onOpenProject?.(src, d.project_id)}
              className="group flex h-11 items-center gap-2.5 rounded-ctl px-2 text-left transition-colors hover:bg-white/[.05]"
            >
              {dp ? <ProjectIcon src={dp.icon_url} size={28} /> : <Skeleton className="h-7 w-7 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-tight text-text">{dp?.title ?? (projects[i]?.isError ? d.project_id : "…")}</span>
                <span className={cn("block text-[11.5px] leading-tight", d.kind === "required" ? "text-muted" : d.kind === "incompatible" ? "text-danger" : "text-dim")}>
                  {t(`project.deps.${d.kind}`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {version && <p className="text-[11.5px] text-dim">{t("project.deps.latest", { version: version.version_number })}</p>}
    </SideSection>
  );
}

function InfoSidebar({
  p,
  target,
  deps,
  onOpenProject,
  note,
}: {
  p: ViewProject;
  target: Instance | null;
  deps: boolean;
  onOpenProject?: (s: Source, id: string) => void;
  note?: ReactNode;
}) {
  const t = useT();
  const links = linkList(p, t);
  const versions = useMemo(() => {
    const rel = p.game_versions.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v)).sort((a, b) => compareMc(b, a));
    return rel.length ? rel : p.game_versions;
  }, [p.game_versions]);
  const shown = versions.slice(0, 12);
  const platforms = p.loaders.filter((x) => x !== "minecraft");
  const content = p.source !== "hangar" ? (p as ProjectDetails) : null;
  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-7 @max-[880px]:hidden">
      {note}
      {target && content && <TargetFit p={content} target={target} />}
      {p.manual_download && p.project_type !== "modpack" && (
        <div className="flex items-start gap-2.5 rounded-card bg-warn/[.08] px-3.5 py-3">
          <ManualBadge iconOnly className="mt-px" />
          <div className="min-w-0 text-[12.5px] leading-snug">
            <div className="font-semibold text-text">{t("manual.badge")}</div>
            <div className="mt-0.5 text-muted">{t("manual.tip")}</div>
          </div>
        </div>
      )}
      <SideSection title={t("project.side.compat")}>
        <div className="text-[12px] text-dim">{p.source === "hangar" ? "Paper" : "Minecraft: Java Edition"}</div>
        <div className="flex flex-wrap gap-1">
          {shown.map((v) => (
            <Pill key={v} className={cn("font-mono text-[11.5px]", target?.mc_version === v ? "bg-ok/15 text-ok" : "text-text")}>
              {v}
            </Pill>
          ))}
          {versions.length > shown.length && <Pill>+{versions.length - shown.length}</Pill>}
          {!versions.length && <span className="text-[13px] text-dim">–</span>}
        </div>
        {platforms.length > 0 && (
          <>
            <div className="mt-1 text-[12px] text-dim">{t("project.side.platforms")}</div>
            <div className="flex flex-wrap gap-1">
              {platforms.map((x) => (
                <Pill key={x} className="text-text">
                  {prettyLoader(x)}
                </Pill>
              ))}
            </div>
          </>
        )}
      </SideSection>
      {deps && content && <Dependencies p={content} target={target} onOpenProject={onOpenProject} />}
      {p.categories.length > 0 && (
        <SideSection title={t("discover.filter.categories")}>
          <div className="flex flex-wrap gap-1">
            {p.categories.map((c) => (
              <Pill key={c} icon={<CategoryIcon id={c} size={12} className="text-dim" />}>
                {categoryLabel(c)}
              </Pill>
            ))}
          </div>
        </SideSection>
      )}
      {links.length > 0 && (
        <SideSection title={t("project.side.links")}>
          <div className="flex flex-col">
            {links.map((l) => (
              <SideLink key={l.key} href={l.href} icon={l.icon}>
                {l.label}
              </SideLink>
            ))}
          </div>
        </SideSection>
      )}
      <SideSection title={t("project.side.details")}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="flex items-center gap-1.5 text-dim">
            <Scale size={12} />
            {t("project.license")}
          </dt>
          <dd className="truncate text-text" title={p.license ?? ""}>
            {p.license ? p.license.replace(/^LicenseRef-/, "").replace(/-/g, " ") : "–"}
          </dd>
          {p.published && (
            <>
              <dt className="text-dim">{t("project.published")}</dt>
              <dd className="text-text">{formatDate(p.published)}</dd>
            </>
          )}
          {p.updated && (
            <>
              <dt className="text-dim">{t("project.updated")}</dt>
              <dd className="text-text">{formatDate(p.updated)}</dd>
            </>
          )}
          <dt className="text-dim">{t("project.source")}</dt>
          <dd className="text-text">{viewSourceName(p.source)}</dd>
        </dl>
      </SideSection>
    </aside>
  );
}

function Description({ p }: { p: ViewProject }) {
  const t = useT();
  if (!p.body.trim()) return <p className="text-[13px] text-dim">{t("project.no_description")}</p>;
  return (
    <div className="max-w-[780px] animate-fade-in">
      <RichText source={p.body} format={p.body_format} />
    </div>
  );
}

function Gallery({ images, onOpen }: { images: ProjectDetails["gallery"]; onOpen: (i: number) => void }) {
  const t = useT();
  if (!images.length) return <p className="text-[13px] text-dim">{t("project.no_gallery")}</p>;
  return (
    <div className="grid grid-cols-2 gap-3 animate-fade-in @min-[1000px]:grid-cols-3">
      {images.map((g, i) => (
        <button
          key={g.url}
          onClick={() => onOpen(i)}
          className="group flex flex-col overflow-hidden rounded-card bg-surface text-left transition-colors duration-150 hover:bg-surface2"
        >
          <span className="relative block aspect-video w-full overflow-hidden bg-surface2">
            <img
              src={g.url}
              alt={g.title ?? ""}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-[var(--ease-snap)] group-hover:scale-[1.03]"
            />
          </span>
          <span className="flex h-[44px] flex-col justify-center px-3">
            <span className="truncate text-[13px] font-medium text-text">{g.title || t("project.image", { n: i + 1 })}</span>
            {g.description && <span className="truncate text-[12px] text-dim">{g.description}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
