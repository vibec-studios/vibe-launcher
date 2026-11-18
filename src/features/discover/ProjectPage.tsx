// Projektseite: kompakter Kopf (Icon, Titel, Kurzbeschreibung, eine Meta-Zeile, Installieren + ⋯-Menü),
// klebende Tab-Leiste Beschreibung / Versionen / Galerie, rechts Infospalte (Kompatibilität, Kategorien, Links, Details).
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { BookOpen, Bug, CalendarClock, Code2, Copy, Download, ExternalLink, FolderPlus, Globe, Heart, MessageCircle, MoreHorizontal } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, DropdownItem, DropdownMenu, DropdownSeparator, ErrorState, IconButton, Skeleton, Tabs, Tag, Tooltip, toast } from "@/components/ui";
import { Lightbox } from "@/components/ui/Lightbox";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatCount, formatDate, formatRelative } from "@/lib/format";
import { qk, useInstances } from "@/lib/queries";
import type { ProjectDetails, Source } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { RichText } from "@/components/content/RichText";
import { openInstall } from "@/components/content/InstallDialog";
import { Pill, prettyCategory, prettyLoader } from "@/components/content/Pill";
import { compareMc, copyText, openExternal, sourceName, versionRange } from "@/components/content/util";
import { VersionsTab } from "./VersionsTab";

const route = getRouteApi("/project/$source/$id");

type Tab = "description" | "versions" | "gallery";

export function ProjectPage() {
  const t = useT();
  const params = route.useParams();
  const search = route.useSearch();
  const decoded = decodeURIComponent(params.source);
  const source: Source = decoded === "curseforge" ? "curseforge" : decoded.startsWith("store:") ? (decoded as Source) : "modrinth";
  const q = useQuery({
    queryKey: qk.project(source, params.id),
    queryFn: () => api.contentProject(source, params.id),
    staleTime: 5 * 60_000,
    placeholderData: undefined,
  });
  const [tab, setTab] = useState<Tab>("description");
  const p = q.data;

  return (
    <div className="scroll h-full">
      <div className="mx-auto w-full max-w-[1180px] px-6 pb-12 pt-4">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} className="rounded-card bg-surface" />
        ) : !p ? (
          <HeaderSkeleton />
        ) : (
          <Header p={p} instanceId={search.instance} />
        )}
        {p && (
          <>
            <div className="sticky top-0 z-10 mt-3 bg-panel">
              <Tabs
                value={tab}
                onChange={setTab}
                className="-mx-3 h-11"
                items={[
                  { value: "description", label: t("project.tab.description") },
                  { value: "versions", label: t("project.tab.versions") },
                  { value: "gallery", label: t("project.tab.gallery"), badge: p.gallery.length || undefined },
                ]}
              />
            </div>
            <div className="flex items-start gap-8 pt-5">
              <div className="min-w-0 flex-1">
                {tab === "description" && <Description p={p} />}
                {tab === "gallery" && <Gallery p={p} />}
                {tab === "versions" && <VersionsTab project={p} instanceId={search.instance} />}
              </div>
              {tab !== "versions" && <InfoSidebar p={p} />}
            </div>
          </>
        )}
        {!p && !q.isError && (
          <div className="mt-6 flex flex-col gap-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
      </div>
    </div>
  );
}

function LinkItems({ p, Item }: { p: ProjectDetails; Item: typeof DropdownItem }) {
  const t = useT();
  const l = p.links;
  const open = (u: string) => void openExternal(u);
  return (
    <>
      {l.website && (
        <Item icon={<Globe size={14} />} onSelect={() => open(l.website!)}>
          {t("project.link.website")}
        </Item>
      )}
      {l.source && (
        <Item icon={<Code2 size={14} />} onSelect={() => open(l.source!)}>
          {t("project.link.source")}
        </Item>
      )}
      {l.issues && (
        <Item icon={<Bug size={14} />} onSelect={() => open(l.issues!)}>
          {t("project.link.issues")}
        </Item>
      )}
      {l.wiki && (
        <Item icon={<BookOpen size={14} />} onSelect={() => open(l.wiki!)}>
          {t("project.link.wiki")}
        </Item>
      )}
      {l.discord && (
        <Item icon={<MessageCircle size={14} />} onSelect={() => open(l.discord!)}>
          Discord
        </Item>
      )}
    </>
  );
}

function Header({ p, instanceId }: { p: ProjectDetails; instanceId?: string }) {
  const t = useT();
  const { data: instances } = useInstances();
  const target = instanceId ? instances?.find((i) => i.id === instanceId) : undefined;
  const isPack = p.project_type === "modpack";
  const loaders = p.loaders.filter((l) => ["fabric", "forge", "neoforge", "quilt"].includes(l));
  const range = versionRange(p.game_versions);
  const hasLinks = !!(p.links.website || p.links.source || p.links.issues || p.links.wiki || p.links.discord);
  const install = () => openInstall({ project: p, instanceId: isPack ? null : instanceId });

  return (
    <div className="flex items-center gap-4 animate-fade-in">
      <ProjectIcon src={p.icon_url} size={64} eager />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-title text-text" title={p.title}>
            {p.title}
          </h1>
          <span className="shrink-0 truncate text-meta text-dim">{t("discover.by", { author: p.author })}</span>
        </div>
        <p className="selectable truncate text-[13px] text-muted" title={p.description}>
          {p.description}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-dim">
          <Tooltip content={t("discover.downloads_n", { n: p.downloads.toLocaleString() })}>
            <span className="flex items-center gap-1">
              <Download size={12} />
              {formatCount(p.downloads)} {t("project.downloads_lc")}
            </span>
          </Tooltip>
          {p.source === "modrinth" && (
            <span className="flex items-center gap-1">
              <Heart size={12} />
              {formatCount(p.follows)} {t("project.follows_lc")}
            </span>
          )}
          {p.updated && (
            <Tooltip content={formatDate(p.updated)}>
              <span className="flex items-center gap-1">
                <CalendarClock size={12} />
                {t("project.updated_ago", { time: formatRelative(p.updated) })}
              </span>
            </Tooltip>
          )}
          {(loaders.length > 0 || range) && (
            <span className="flex items-center gap-1">
              {loaders.map((l) => (
                <Tag key={l} className="text-text">
                  {prettyLoader(l)}
                </Tag>
              ))}
              {range && <Tag className="text-text">{range}</Tag>}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="primary" icon={isPack ? <FolderPlus size={15} /> : <Download size={15} />} onClick={install}>
          {isPack ? t("install.as_new_instance_short") : target ? t("project.install_into", { name: target.name }) : t("common.install")}
        </Button>
        <DropdownMenu
          trigger={
            <IconButton label={t("common.more")} tip variant="ghost">
              <MoreHorizontal size={16} />
            </IconButton>
          }
        >
          {hasLinks && (
            <>
              <LinkItems p={p} Item={DropdownItem} />
              <DropdownSeparator />
            </>
          )}
          <DropdownItem icon={<ExternalLink size={14} />} onSelect={() => void openExternal(p.page_url)}>
            {t("project.open_on", { source: sourceName(p.source) })}
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
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="h-[64px] w-[64px] shrink-0 rounded-card" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-9 w-[132px] shrink-0" />
    </div>
  );
}

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12.5px] font-semibold text-muted">{title}</h3>
      {children}
    </section>
  );
}

function SideLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a href={href} className="-mx-2 flex h-8 items-center gap-2.5 rounded-ctl px-2 text-[13px] text-muted transition-colors hover:bg-white/[.04] hover:text-text">
      <span className="text-dim">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      <ExternalLink size={12} className="text-dim" />
    </a>
  );
}

function InfoSidebar({ p }: { p: ProjectDetails }) {
  const t = useT();
  const l = p.links;
  const versions = useMemo(() => {
    const rel = p.game_versions.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v)).sort((a, b) => compareMc(b, a));
    return rel.length ? rel : p.game_versions;
  }, [p.game_versions]);
  const shown = versions.slice(0, 12);
  const platforms = p.loaders.filter((x) => x !== "minecraft");
  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-6">
      <SideSection title={t("project.side.compat")}>
        <div className="text-[12px] text-dim">Minecraft: Java Edition</div>
        <div className="flex flex-wrap gap-1">
          {shown.map((v) => (
            <Pill key={v} className="font-mono text-[11.5px] text-text">
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
      {p.categories.length > 0 && (
        <SideSection title={t("discover.filter.categories")}>
          <div className="flex flex-wrap gap-1">
            {p.categories.map((c) => (
              <Pill key={c}>{prettyCategory(c)}</Pill>
            ))}
          </div>
        </SideSection>
      )}
      {(l.website || l.source || l.issues || l.wiki || l.discord) && (
        <SideSection title={t("project.side.links")}>
          <div className="flex flex-col">
            {l.website && (
              <SideLink href={l.website} icon={<Globe size={14} />}>
                {t("project.link.website")}
              </SideLink>
            )}
            {l.source && (
              <SideLink href={l.source} icon={<Code2 size={14} />}>
                {t("project.link.source")}
              </SideLink>
            )}
            {l.issues && (
              <SideLink href={l.issues} icon={<Bug size={14} />}>
                {t("project.link.issues")}
              </SideLink>
            )}
            {l.wiki && (
              <SideLink href={l.wiki} icon={<BookOpen size={14} />}>
                {t("project.link.wiki")}
              </SideLink>
            )}
            {l.discord && (
              <SideLink href={l.discord} icon={<MessageCircle size={14} />}>
                Discord
              </SideLink>
            )}
          </div>
        </SideSection>
      )}
      <SideSection title={t("project.side.details")}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-dim">{t("project.license")}</dt>
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
          <dd className="text-text">{sourceName(p.source)}</dd>
        </dl>
      </SideSection>
    </aside>
  );
}

function Description({ p }: { p: ProjectDetails }) {
  const t = useT();
  if (!p.body.trim()) return <p className="text-[13px] text-dim">{t("project.no_description")}</p>;
  return (
    <div className="max-w-[860px] animate-fade-in">
      <RichText source={p.body} format={p.body_format} />
    </div>
  );
}

function Gallery({ p }: { p: ProjectDetails }) {
  const t = useT();
  const [index, setIndex] = useState<number | null>(null);
  const images = useMemo(() => [...p.gallery].sort((a, b) => Number(b.featured) - Number(a.featured)), [p.gallery]);
  if (!images.length) return <p className="text-[13px] text-dim">{t("project.no_gallery")}</p>;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 animate-fade-in xl:grid-cols-3">
        {images.map((g, i) => (
          <button
            key={g.url}
            onClick={() => setIndex(i)}
            className="group flex flex-col overflow-hidden rounded-card bg-surface text-left transition-colors duration-150 hover:bg-surface2"
          >
            <span className="relative block aspect-video w-full overflow-hidden bg-surface2">
              <img
                src={g.url}
                alt={g.title ?? ""}
                loading="lazy"
                decoding="async"
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </span>
            <span className="flex h-[44px] flex-col justify-center px-3">
              <span className="truncate text-[13px] font-medium text-text">{g.title || t("project.image", { n: i + 1 })}</span>
              {g.description && <span className="truncate text-[12px] text-dim">{g.description}</span>}
            </span>
          </button>
        ))}
      </div>
      <Lightbox
        images={images}
        index={index}
        onIndexChange={setIndex}
        onClose={() => setIndex(null)}
        labels={{ prev: t("project.prev"), next: t("project.next"), close: t("common.close") }}
      />
    </>
  );
}
