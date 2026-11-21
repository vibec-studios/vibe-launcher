import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import type { Source } from "@/lib/types";
import { providerOf } from "@/features/installtarget/hooks";
import type { ServerTargetInfo } from "@/features/installtarget/types";
import type { AddonSource } from "@/features/servers/addonsApi";
import { ProjectSheet, useProjectOverlayNav } from "../ProjectOverlay";
import { ProjectView, ProjectViewSkeleton, type ViewProject } from "../ProjectView";
import { ServerInstallButton } from "./parts";

export function parseAddonParam(v: string): { source: AddonSource; id: string } | null {
  const i = v.indexOf(":");
  if (i <= 0 || i === v.length - 1) return null;
  const s = v.slice(0, i);
  if (s !== "modrinth" && s !== "hangar") return null;
  return { source: s, id: v.slice(i + 1) };
}

export function ServerSheet({ target, value }: { target: ServerTargetInfo; value: string }) {
  const t = useT();
  const nav = useProjectOverlayNav();
  const parsed = parseAddonParam(value);
  const q = useQuery({
    queryKey: ["server-addon-project", parsed?.source, parsed?.id, parsed?.source === "hangar" ? target.key : ""],
    queryFn: (): Promise<ViewProject> => (parsed!.source === "hangar" ? providerOf(target).hangarProject(target, parsed!.id) : api.contentProject("modrinth", parsed!.id)),
    enabled: !!parsed,
    staleTime: 5 * 60_000,
  });
  const p = q.data;
  return (
    <ProjectSheet
      viewKey={value}
      canBack={nav.depth > 1}
      onBack={nav.back}
      onClose={nav.close}
      pageUrl={p?.page_url}
      pageLabel={p ? t("project.open_on", { source: parsed?.source === "hangar" ? "Hangar" : "Modrinth" }) : undefined}
    >
      {!parsed ? (
        <ErrorState error={t("project.invalid")} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} className="rounded-card bg-surface" />
      ) : !p ? (
        <ProjectViewSkeleton />
      ) : (
        <ProjectView
          key={value}
          p={p}
          target={null}
          install={<ServerInstallButton target={target} source={parsed.source} project={parsed.source === "hangar" ? parsed.id : p.id} title={p.title} wide />}
          versions={false}
          deps={parsed.source === "modrinth"}
          onOpenProject={(source: Source, id: string) => source === "modrinth" && nav.open("modrinth", id)}
        />
      )}
    </ProjectSheet>
  );
}
