// Versionen eines Projekts: filterbar (MC-Version, Loader, Typ), Changelog aufklappbar, bestimmte Version installieren.
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download, FolderPlus } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, Segmented, Select, Skeleton, Tag, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatBytes, formatCount, formatDate, formatLoader } from "@/lib/format";
import { qk, useInstances } from "@/lib/queries";
import type { ProjectDetails, ProjectVersion } from "@/lib/types";
import { RichText } from "@/components/content/RichText";
import { Pill, prettyLoader } from "@/components/content/Pill";
import { openInstall } from "@/components/content/InstallDialog";
import { compareMc } from "@/components/content/util";

const ALL = "__all";
const STEP = 40;
const typeColor: Record<ProjectVersion["release_type"], string> = { release: "var(--color-ok)", beta: "var(--color-warn)", alpha: "var(--color-danger)" };
const COLS = "grid-cols-[minmax(0,1fr)_110px_96px_84px_136px] @min-[900px]:grid-cols-[minmax(0,1fr)_140px_110px_88px_72px_148px]";

export function VersionsTab({ project, instanceId }: { project: ProjectDetails; instanceId?: string }) {
  const t = useT();
  const { data: instances } = useInstances();
  const target = instanceId ? instances?.find((i) => i.id === instanceId) : undefined;
  const q = useQuery({
    queryKey: qk.versions(project.source, project.id, null, null),
    queryFn: () => api.contentVersions(project.source, project.id, null, null),
    staleTime: 5 * 60_000,
    placeholderData: undefined,
  });
  const all = q.data ?? [];
  const gameVersions = useMemo(
    () => [...new Set(all.flatMap((v) => v.game_versions))].sort((a, b) => (/^\d/.test(a) && /^\d/.test(b) ? compareMc(b, a) : a.localeCompare(b))),
    [all],
  );
  const loaders = useMemo(() => [...new Set(all.flatMap((v) => v.loaders))].sort(), [all]);
  const [gv, setGv] = useState<string>(() => target?.mc_version ?? ALL);
  const [loader, setLoader] = useState<string>(() => (target && target.loader.kind !== "vanilla" && project.project_type === "mod" ? target.loader.kind : ALL));
  const [type, setType] = useState<"all" | ProjectVersion["release_type"]>("all");
  const [limit, setLimit] = useState(STEP);
  const [open, setOpen] = useState<string | null>(null);

  // Vorbelegung aus der Ziel-Instanz nur anwenden, wenn es passende Versionen gibt
  const gvEff = gameVersions.includes(gv) ? gv : ALL;
  const loaderEff = loaders.includes(loader) ? loader : ALL;
  const filtered = useMemo(
    () =>
      all.filter(
        (v) =>
          (gvEff === ALL || v.game_versions.includes(gvEff)) && (loaderEff === ALL || v.loaders.includes(loaderEff)) && (type === "all" || v.release_type === type),
      ),
    [all, gvEff, loaderEff, type],
  );

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[170px]">
        <Select
          size="sm"
          variant="ghost"
          value={gvEff}
          onChange={(v) => (setGv(v), setLimit(STEP))}
          options={[{ value: ALL, label: t("discover.filter.all_versions") }, ...gameVersions.map((v) => ({ value: v, label: v }))]}
          disabled={q.isPending}
        />
        </div>
        {loaders.length > 1 && (
          <div className="w-[150px]">
          <Select
            size="sm"
            variant="ghost"
            value={loaderEff}
            onChange={(v) => (setLoader(v), setLimit(STEP))}
            options={[
              { value: ALL, label: t("versions.all_loaders") },
              ...loaders.map((l) => ({ value: l, label: ["fabric", "forge", "neoforge", "quilt", "vanilla"].includes(l) ? formatLoader({ kind: l as never, version: null }) : l })),
            ]}
          />
          </div>
        )}
        <Segmented
          value={type}
          onChange={(v) => (setType(v), setLimit(STEP))}
          items={[
            { value: "all", label: t("common.all") },
            { value: "release", label: t("versions.type.release") },
            { value: "beta", label: t("versions.type.beta") },
            { value: "alpha", label: t("versions.type.alpha") },
          ]}
        />
        <span className="ml-auto text-meta text-dim">{q.data && t("versions.count", { n: filtered.length })}</span>
      </div>

      <div className="@container">
        <div className={cn("grid items-center gap-4 border-b border-line px-3 pb-2", COLS)}>
          <span className="label">{t("versions.col.name")}</span>
          <span className="label">{t("versions.col.game")}</span>
          <span className="label">{t("versions.col.loader")}</span>
          <span className="label">{t("versions.col.date")}</span>
          <span className="label hidden text-right @min-[900px]:block">{t("versions.col.downloads")}</span>
          <span />
        </div>
        {q.isPending ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={cn("grid h-[56px] items-center gap-4 border-b border-line px-3 last:border-b-0", COLS)}>
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ml-auto hidden h-4 w-12 @min-[900px]:block" />
              <Skeleton className="ml-auto h-8 w-24" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <EmptyState title={t("versions.empty")} text={t("versions.empty_text")} className="py-10" />
        ) : (
          filtered.slice(0, limit).map((v) => (
            <VersionRow key={v.id} v={v} project={project} instanceId={instanceId} open={open === v.id} onToggle={() => setOpen((o) => (o === v.id ? null : v.id))} />
          ))
        )}
      </div>
      {filtered.length > limit && (
        <Button variant="ghost" className="self-center" onClick={() => setLimit((l) => l + STEP)}>
          {t("versions.more", { n: filtered.length - limit })}
        </Button>
      )}
    </div>
  );
}

const VersionRow = memo(function VersionRow({
  v,
  project,
  instanceId,
  open,
  onToggle,
}: {
  v: ProjectVersion;
  project: ProjectDetails;
  instanceId?: string;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const isPack = project.project_type === "modpack";
  const games = [...v.game_versions].sort((a, b) => compareMc(b, a));
  const primary = v.files.find((f) => f.primary) ?? v.files[0];
  return (
    <div className="border-b border-line last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
        className={cn("grid h-[56px] cursor-pointer items-center gap-4 rounded-ctl px-3 transition-colors duration-150 hover:bg-white/[.03]", COLS, open && "bg-white/[.03]")}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span title={t(`versions.type.${v.release_type}`)} className="shrink-0">
            <Tag color={typeColor[v.release_type]} className="min-w-5 justify-center font-bold">
              {v.release_type[0]}
            </Tag>
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-medium text-text">{v.name || v.version_number}</div>
            <div className="truncate font-mono text-[11px] text-dim">
              {v.version_number}
              {primary ? ` · ${formatBytes(primary.size)}` : ""}
            </div>
          </div>
        </div>
        <div className="truncate font-mono text-[12px] text-muted" title={games.join(", ")}>
          {games.slice(0, 2).join(", ")}
          {games.length > 2 && <span className="text-dim">{` +${games.length - 2}`}</span>}
        </div>
        <div className="flex min-w-0 gap-1 overflow-hidden">
          {v.loaders.slice(0, 2).map((l) => (
            <Pill key={l}>{prettyLoader(l)}</Pill>
          ))}
        </div>
        <div className="text-[13px] text-muted">{formatDate(v.date)}</div>
        <div className="hidden text-right text-[13px] text-muted @min-[900px]:block">{formatCount(v.downloads)}</div>
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={isPack ? <FolderPlus size={13} /> : <Download size={13} />}
            onClick={(e) => {
              e.stopPropagation();
              openInstall({ project, versionId: v.id, instanceId: isPack ? null : instanceId });
            }}
          >
            {t("common.install")}
          </Button>
          <ChevronDown size={14} className={cn("shrink-0 text-dim transition-transform duration-150", open && "rotate-180")} />
        </div>
      </div>
      {open && (
        <div className="mx-3 mb-3 rounded-card bg-surface py-3.5 pl-8 pr-4 animate-fade-in">
          <div className="label mb-2">{t("versions.changelog")}</div>
          {v.changelog?.trim() ? (
            <RichText source={v.changelog} format={project.body_format === "html" && /<\w+/.test(v.changelog) ? "html" : "markdown"} compact />
          ) : (
            <p className="text-[12.5px] text-dim">{t("versions.no_changelog")}</p>
          )}
          {v.dependencies.filter((d) => d.kind === "required").length > 0 && (
            <div className="mt-3 text-[12px] text-dim">{t("versions.deps", { n: v.dependencies.filter((d) => d.kind === "required").length })}</div>
          )}
        </div>
      )}
    </div>
  );
});
