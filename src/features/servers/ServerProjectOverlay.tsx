// Projekt-Overlay für Server-Plugins/-Mods (Modrinth und Hangar): dieselbe Ansicht wie auf „Entdecken“, mit
// „Auf Server installieren“ statt Instanzwahl. Navigation (Abhängigkeiten) über einen eigenen Stapel; Maus-Zurück
// geht erst zum vorigen Projekt und schließt dann – der Server-Tab bleibt dahinter erhalten.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Download } from "lucide-react";
import { Button, ErrorState, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { Server, Source } from "@/lib/types";
import { ProjectSheet } from "@/features/discover/ProjectOverlay";
import { ProjectView, ProjectViewSkeleton, type ViewProject } from "@/features/discover/ProjectView";
import { addonApi, aqk, type AddonList, type AddonSource } from "./addonsApi";

export interface AddonRef {
  source: AddonSource;
  id: string;
}

export function ServerProjectOverlay({ server, list, stack, onStack }: { server: Server; list: AddonList; stack: AddonRef[]; onStack: (s: AddonRef[]) => void }) {
  const t = useT();
  const cur = stack[stack.length - 1];
  const q = useQuery({
    queryKey: ["server-addon-project", cur.source, cur.id],
    queryFn: async (): Promise<ViewProject> => (cur.source === "hangar" ? addonApi.project(cur.id) : api.contentProject("modrinth", cur.id)),
    staleTime: 5 * 60_000,
  });
  const p = q.data;
  const installed =
    !!p &&
    list.items.some(
      (a) => a.project_id === p.id || a.project_id === cur.id || (a.title ?? a.name ?? "").toLowerCase() === p.title.toLowerCase(),
    );
  const install = useMutation({
    mutationFn: () => addonApi.install(server.id, cur.source, cur.id),
    onSuccess: (files) => {
      toast.success(
        files.length > 1 ? tt("srv.addons.installed_deps", { name: p?.title ?? cur.id, n: files.length - 1 }) : tt("srv.addons.installed", { name: p?.title ?? cur.id }),
        tt("srv.addons.restart_hint"),
      );
      void queryClient.invalidateQueries({ queryKey: aqk.addons(server.id) });
      void queryClient.invalidateQueries({ queryKey: aqk.updates(server.id) });
    },
    onError: (e) => toast.error(e, tt("srv.addons.install_failed")),
  });
  const close = () => onStack([]);
  const back = () => (stack.length > 1 ? onStack(stack.slice(0, -1)) : close());

  const button = installed ? (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-ctl bg-ok/12 px-3.5 text-[13.5px] font-semibold text-ok">
      <Check size={15} strokeWidth={2.5} />
      {t("srv.addons.installed_tag")}
    </span>
  ) : (
    <Button variant="primary" icon={<Download size={15} />} loading={install.isPending} onClick={() => install.mutate()}>
      {t("srv.addons.install_on", { name: server.name })}
    </Button>
  );

  return (
    <ProjectSheet
      viewKey={`${cur.source}:${cur.id}`}
      canBack={stack.length > 1}
      onBack={back}
      onClose={close}
      pageUrl={p?.page_url}
      pageLabel={p ? t("project.open_on", { source: cur.source === "hangar" ? "Hangar" : "Modrinth" }) : undefined}
    >
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} className="rounded-card bg-surface" />
      ) : !p ? (
        <ProjectViewSkeleton />
      ) : (
        <ProjectView
          key={`${cur.source}:${cur.id}`}
          p={p}
          target={null}
          install={button}
          versions={false}
          deps={cur.source === "modrinth"}
          onOpenProject={(source: Source, id: string) => source === "modrinth" && onStack([...stack, { source: "modrinth", id }])}
        />
      )}
    </ProjectSheet>
  );
}
