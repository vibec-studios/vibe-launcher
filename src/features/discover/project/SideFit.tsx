import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";
import { useMemo } from "react";
import { Skeleton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatLoader } from "@/lib/format";
import { qk } from "@/lib/queries";
import type { Dependency, Instance, ProjectDetails, Source } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { compatibility, contentKindOf } from "@/components/content/util";
import { SideSection } from "./SideSection";

/** Passt das Projekt zur Ziel-Instanz? */
export function TargetFit({ p, target }: { p: ProjectDetails; target: Instance }) {
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

export const DEP_ORDER: Record<string, number> = { required: 0, optional: 1, incompatible: 2, embedded: 3 };

/** Abhängigkeiten der neuesten (zur Ziel-Instanz passenden) Version; Klick öffnet sie in derselben Ansicht. */
export function Dependencies({ p, target, onOpenProject }: { p: ProjectDetails; target: Instance | null; onOpenProject?: (s: Source, id: string) => void }) {
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
