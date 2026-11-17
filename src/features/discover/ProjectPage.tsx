// Projektseite: Kopf (Icon, Titel, Stats, Kategorien, Loader/Versionen, Installieren, Links) + Tabs
// Beschreibung (bereinigt), Galerie (Lightbox), Versionen (filterbar, Changelog, bestimmte Version installieren).
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, Bug, Calendar, Code2, Copy, Download, ExternalLink, FolderPlus, Globe, Heart, MessageCircle, Scale } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, ErrorState, IconButton, Skeleton, Tabs, Tag, Tooltip, toast } from "@/components/ui";
import { Lightbox } from "@/components/ui/Lightbox";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatCount, formatDate, formatLoader, formatRelative } from "@/lib/format";
import { qk, useInstances } from "@/lib/queries";
import type { ProjectDetails, Source } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { RichText } from "@/components/content/RichText";
import { openInstall } from "@/components/content/InstallDialog";
import { copyText, openExternal, sourceNames, versionRange } from "@/components/content/util";
import { VersionsTab } from "./VersionsTab";

const route = getRouteApi("/project/$source/$id");

type Tab = "description" | "gallery" | "versions";

export function ProjectPage() {
  const t = useT();
  const params = route.useParams();
  const search = route.useSearch();
  const source: Source = params.source === "curseforge" ? "curseforge" : "modrinth";
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
      <div className="mx-auto w-full max-w-[1140px] px-8 pb-16 pt-5">
        <BackBar type={p?.project_type} instance={search.instance} />
        {q.isError ? (
          <div className="mt-4 border border-line bg-surface">
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !p ? (
          <HeaderSkeleton />
        ) : (
          <Header p={p} instanceId={search.instance} />
        )}
        {p && (
          <>
            <div className="sticky top-0 z-10 mt-6 bg-black">
              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  { value: "description", label: t("project.tab.description") },
                  { value: "gallery", label: t("project.tab.gallery"), badge: p.gallery.length || undefined },
                  { value: "versions", label: t("project.tab.versions") },
                ]}
              />
            </div>
            <div className="pt-6">
              {tab === "description" && <Description p={p} />}
              {tab === "gallery" && <Gallery p={p} />}
              {tab === "versions" && <VersionsTab project={p} instanceId={search.instance} />}
            </div>
          </>
        )}
        {!p && !q.isError && (
          <div className="mt-6 flex flex-col gap-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
      </div>
    </div>
  );
}

function BackBar({ type, instance }: { type?: string; instance?: string }) {
  const t = useT();
  const router = useRouter();
  const canBack = typeof window !== "undefined" && window.history.length > 1;
  return (
    <div className="flex h-9 items-center gap-3 font-mono text-[11px] uppercase tracking-[.1em] text-dim">
      <button
        className="flex items-center gap-1.5 text-muted transition-colors hover:text-white"
        onClick={() => (canBack ? router.history.back() : router.navigate({ to: "/discover", search: { instance } }))}
      >
        <ArrowLeft size={13} />
        {t("common.back")}
      </button>
      <span className="text-line2">/</span>
      <Link to="/discover" search={{ instance, type: (type as never) || undefined }} className="transition-colors hover:text-white">
        {t("nav.discover")}
      </Link>
      {type && (
        <>
          <span className="text-line2">/</span>
          <span>{t(`discover.tab.${type}`)}</span>
        </>
      )}
    </div>
  );
}

function Stat({ icon, label, value, title }: { icon: ReactNode; label: string; value: ReactNode; title?: string }) {
  return (
    <div className="min-w-0 px-6 py-4" title={title}>
      <div className="label flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 truncate font-mono text-[15px] font-semibold text-white">{value}</div>
    </div>
  );
}

function LinkChip({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-8 items-center gap-2 border border-line2 px-3 font-mono text-[11.5px] text-text transition-colors duration-150 hover:border-accent"
    >
      {icon}
      {children}
      <ExternalLink size={11} className="text-dim" />
    </a>
  );
}

function Header({ p, instanceId }: { p: ProjectDetails; instanceId?: string }) {
  const t = useT();
  const { data: instances } = useInstances();
  const target = instanceId ? instances?.find((i) => i.id === instanceId) : undefined;
  const isPack = p.project_type === "modpack";
  const loaders = p.loaders.filter((l) => ["fabric", "forge", "neoforge", "quilt"].includes(l));
  const range = versionRange(p.game_versions);
  const links = p.links;
  const install = () => openInstall({ project: p, instanceId: isPack ? null : instanceId });

  return (
    <div className="mt-3 border border-line border-t-2 border-t-accent bg-surface animate-fade-in">
      <div className="flex items-start gap-6 p-7">
        <ProjectIcon src={p.icon_url} size={104} eager />
        <div className="min-w-0 flex-1">
          <div className="eyebrow mb-2">
            {t(`discover.type.${p.project_type}`)} · {sourceNames[p.source]}
          </div>
          <h1 className="display break-words text-[30px]">{p.title}</h1>
          <p className="selectable mt-2.5 max-w-[640px] text-[15px] leading-relaxed text-muted">{p.description}</p>
          <div className="mt-2 text-[13px] text-dim">{t("discover.by", { author: p.author })}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3">
          <Button variant="accent" size="lg" icon={isPack ? <FolderPlus size={16} /> : <Download size={16} />} onClick={install} className="min-w-[200px]">
            {isPack ? t("install.as_new_instance_short") : target ? t("project.install_into", { name: target.name }) : t("common.install")}
          </Button>
          <div className="flex gap-2">
            <Tooltip content={t("discover.menu.browser")}>
              <IconButton label={t("discover.menu.browser")} onClick={() => void openExternal(p.page_url)}>
                <ExternalLink size={15} />
              </IconButton>
            </Tooltip>
            <Tooltip content={t("discover.menu.copy_link")}>
              <IconButton
                label={t("discover.menu.copy_link")}
                onClick={() =>
                  copyText(p.page_url)
                    .then(() => toast.success(t("common.copied"), p.page_url))
                    .catch((e) => toast.error(e))
                }
              >
                <Copy size={15} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-4 border-t border-line [&>*+*]:border-l [&>*+*]:border-line">
        <Stat icon={<Download size={11} />} label={t("project.downloads")} value={formatCount(p.downloads)} title={p.downloads.toLocaleString()} />
        <Stat icon={<Heart size={11} />} label={t("project.follows")} value={formatCount(p.follows)} title={p.follows.toLocaleString()} />
        <Stat icon={<Calendar size={11} />} label={t("project.updated")} value={formatRelative(p.updated)} title={formatDate(p.updated)} />
        <Stat icon={<Scale size={11} />} label={t("project.license")} value={p.license ? p.license.replace(/^LicenseRef-/, "").replace(/-/g, " ") : "–"} />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line px-7 py-4">
        {(loaders.length > 0 || range) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {loaders.map((l) => (
              <Tag key={l}>{formatLoader({ kind: l as never, version: null })}</Tag>
            ))}
            {range && <Tag className="normal-case tracking-normal text-text">MC {range}</Tag>}
          </div>
        )}
        {p.categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {p.categories.map((c) => (
              <Tag key={c}>{c.replace(/-/g, " ")}</Tag>
            ))}
          </div>
        )}
      </div>
      {(links.website || links.source || links.issues || links.wiki || links.discord) && (
        <div className="flex flex-wrap gap-2 border-t border-line px-7 py-4">
          {links.website && (
            <LinkChip href={links.website} icon={<Globe size={13} />}>
              {t("project.link.website")}
            </LinkChip>
          )}
          {links.source && (
            <LinkChip href={links.source} icon={<Code2 size={13} />}>
              {t("project.link.source")}
            </LinkChip>
          )}
          {links.issues && (
            <LinkChip href={links.issues} icon={<Bug size={13} />}>
              {t("project.link.issues")}
            </LinkChip>
          )}
          {links.wiki && (
            <LinkChip href={links.wiki} icon={<BookOpen size={13} />}>
              {t("project.link.wiki")}
            </LinkChip>
          )}
          {links.discord && (
            <LinkChip href={links.discord} icon={<MessageCircle size={13} />}>
              Discord
            </LinkChip>
          )}
        </div>
      )}
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="mt-3 border border-line border-t-2 border-t-line2 bg-surface">
      <div className="flex items-start gap-6 p-7">
        <Skeleton className="h-[104px] w-[104px] shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-2/5" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-[52px] w-[200px] shrink-0" />
      </div>
      <div className="grid grid-cols-4 border-t border-line">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 px-6 py-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      <div className="h-[61px] border-t border-line" />
    </div>
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
      <div className="grid grid-cols-3 gap-4 animate-fade-in">
        {images.map((g, i) => (
          <button
            key={g.url}
            onClick={() => setIndex(i)}
            className="group flex flex-col border border-line bg-surface text-left transition-colors duration-150 hover:border-line2"
          >
            <span className="relative block aspect-video w-full overflow-hidden bg-surface2">
              <img
                src={g.url}
                alt={g.title ?? ""}
                loading="lazy"
                decoding="async"
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]"
              />
            </span>
            <span className="flex h-[52px] flex-col justify-center px-3.5">
              <span className="truncate text-[13px] font-medium text-white">{g.title || t("project.image", { n: i + 1 })}</span>
              {g.description && <span className="truncate text-[11.5px] text-dim">{g.description}</span>}
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
