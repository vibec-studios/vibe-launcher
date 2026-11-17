// OWNER: Frontend-Agent A. Startseite wie ein Desktop-Launcher: Weiterspielen (zuletzt gespielte Instanzen)
// und Entdecken-Reihen (beliebte Modpacks / Mods von Modrinth).
import { memo, useCallback, useMemo, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, PackageOpen, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useAccounts, useInstances } from "@/lib/queries";
import type { Instance, ProjectHit, ProjectType, SearchQuery } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { Button, ErrorState, Skeleton } from "@/components/ui";
import { Logo3D } from "@/components/Logo3D";
import { InstanceRow } from "@/components/instance/InstanceCard";
import { openNewInstance, useInstanceActions } from "@/components/instance/actions";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { openImport } from "@/features/import/ImportDialog";
import { useT } from "@/i18n";

const rowGrid = "grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2.5";
const cardGrid = "grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5";

function SectionHead({ title, link }: { title: string; link?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center gap-3">
      <h2 className="min-w-0 flex-1 truncate text-[16px] font-bold text-white">{title}</h2>
      {link}
    </div>
  );
}

function MoreLink({ children, to, search }: { children: ReactNode; to: "/instances" | "/discover"; search?: Record<string, string> }) {
  return (
    <Link to={to} search={search as never} className="group flex shrink-0 items-center gap-0.5 text-[13px] font-medium text-muted hover:text-white">
      {children}
      <ChevronRight size={15} className="transition-transform duration-150 group-hover:translate-x-0.5" />
    </Link>
  );
}

const ProjectCard = memo(function ProjectCard({ hit, onOpen }: { hit: ProjectHit; onOpen: (h: ProjectHit) => void }) {
  const t = useT();
  return (
    <button
      onClick={() => onOpen(hit)}
      className="group flex min-w-0 gap-3 border border-line bg-surface p-2.5 text-left transition-colors duration-100 hover:border-line2 hover:bg-surface2"
    >
      <ProjectIcon src={hit.icon_url} size={64} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-white">{hit.title}</div>
        <div className="truncate text-[12px] text-dim">{t("home.by", { author: hit.author })}</div>
        <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-muted">{hit.description}</p>
        <div className="mt-1.5 flex items-center gap-1 text-[12px] text-dim">
          <Download size={12} />
          {formatCount(hit.downloads)}
        </div>
      </div>
    </button>
  );
});

function ProjectRow({ type, title }: { type: ProjectType; title: string }) {
  const t = useT();
  const nav = useNavigate();
  const query: SearchQuery = {
    source: "modrinth",
    query: "",
    project_type: type,
    game_version: null,
    loader: null,
    categories: [],
    sort: "downloads",
    offset: 0,
    limit: 8,
  };
  const q = useQuery({ queryKey: qk.search(query), queryFn: () => api.contentSearch(query), staleTime: 15 * 60_000, retry: 1 });
  const onOpen = useCallback((h: ProjectHit) => nav({ to: "/project/$source/$id", params: { source: h.source, id: h.id }, search: {} }), [nav]);
  return (
    <section>
      <SectionHead
        title={title}
        link={
          <MoreLink to="/discover" search={{ type }}>
            {t("home.more")}
          </MoreLink>
        }
      />
      {q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} className="border border-line bg-surface py-8" />
      ) : !q.data ? (
        <div className={cardGrid}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex gap-3 border border-line bg-surface p-2.5">
              <Skeleton className="h-16 w-16" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={cardGrid}>
          {q.data.hits.slice(0, 8).map((h) => (
            <ProjectCard key={h.id} hit={h} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyLibrary() {
  const t = useT();
  return (
    <div className="flex items-center gap-5 border border-line bg-surface px-5 py-4">
      <div className="shrink-0">
        <Logo3D size={64} speed={0} hoverSpin float={false} interactive={false} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-white">{t("home.empty.title")}</div>
        <p className="mt-0.5 text-[13px] text-muted">{t("home.empty.text")}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button icon={<PackageOpen size={15} />} onClick={() => openImport()}>
          {t("home.action.import")}
        </Button>
        <Button variant="primary" icon={<Plus size={16} />} onClick={openNewInstance}>
          {t("inst.new")}
        </Button>
      </div>
    </div>
  );
}

export function HomePage() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useInstances();
  const { data: accounts = [] } = useAccounts();
  const { open } = useInstanceActions();
  const onOpen = useCallback((i: Instance) => open(i), [open]);
  const active = accounts.find((a) => a.active) ?? accounts[0];

  const recent = useMemo(
    () =>
      (data ?? [])
        .slice()
        .sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0) || b.created_at - a.created_at)
        .slice(0, 6),
    [data],
  );

  return (
    <div className="scroll h-full">
      <div className="flex flex-col gap-7 px-6 pb-10 pt-5">
        <h1 className="display text-[22px]">{active ? t("home.welcome_name", { name: active.username }) : t("home.welcome")}</h1>

        <section>
          {isError && !data ? (
            <ErrorState error={error} onRetry={() => refetch()} className="border border-line bg-surface py-8" />
          ) : isLoading && !data ? (
            <>
              <SectionHead title={t("home.continue")} />
              <div className={rowGrid}>
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="flex items-center gap-3 border border-line bg-surface p-2">
                    <Skeleton className="h-12 w-12" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : recent.length === 0 ? (
            <EmptyLibrary />
          ) : (
            <>
              <SectionHead title={t("home.continue")} link={<MoreLink to="/instances">{t("home.open_library")}</MoreLink>} />
              <div className={rowGrid}>
                {recent.map((i) => (
                  <InstanceRow key={i.id} instance={i} onOpen={onOpen} />
                ))}
              </div>
            </>
          )}
        </section>

        <ProjectRow type="modpack" title={t("home.popular_packs")} />
        <ProjectRow type="mod" title={t("home.popular_mods")} />
      </div>
    </div>
  );
}
