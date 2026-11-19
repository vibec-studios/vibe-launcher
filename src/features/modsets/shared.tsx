// OWNER: Content-Agent. Gemeinsame Bausteine der Mod-Sets: Cover (Icon-Collage), Zusammenfassungen, globale Dialoge.
import { Layers } from "lucide-react";
import { create } from "zustand";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { prettyLoader } from "@/components/content/Pill";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { loaderNames } from "@/lib/format";
import type { LoaderKind, ProjectType } from "@/lib/types";
import type { ModSet, Reason, SetEntry } from "./api";

/** 2×2-Collage der ersten Projekt-Icons (leeres Set: Ebenen-Symbol). */
export function SetCover({ set, size = 44, className }: { set: Pick<ModSet, "entries">; size?: number; className?: string }) {
  const icons = set.entries.slice(0, 4);
  const cell = Math.floor((size - 2) / 2);
  if (icons.length === 0)
    return (
      <span className={cn("grid shrink-0 place-items-center rounded-card bg-surface2 text-dim", className)} style={{ width: size, height: size }}>
        <Layers size={Math.round(size * 0.42)} strokeWidth={1.6} />
      </span>
    );
  if (icons.length === 1) return <ProjectIcon src={icons[0].icon_url} size={size} className={className} />;
  return (
    <span className={cn("grid shrink-0 grid-cols-2 gap-[2px] overflow-hidden rounded-card", className)} style={{ width: size, height: size }}>
      {Array.from({ length: 4 }, (_, i) =>
        icons[i] ? (
          <ProjectIcon key={i} src={icons[i].icon_url} size={cell} className="!rounded-none" />
        ) : (
          <span key={i} className="bg-surface2" style={{ width: cell, height: cell }} />
        ),
      )}
    </span>
  );
}

const TYPE_ORDER: ProjectType[] = ["mod", "shader", "resourcepack", "datapack", "modpack"];

/** „9 Mods · 2 Shader · 1 Ressourcenpaket“ */
export function typeSummary(t: ReturnType<typeof useT>, entries: SetEntry[]): string {
  const counts = new Map<ProjectType, number>();
  for (const e of entries) counts.set(e.project_type, (counts.get(e.project_type) ?? 0) + 1);
  return TYPE_ORDER.filter((k) => counts.get(k))
    .map((k) => (counts.get(k) === 1 ? `1 ${t(`sets.type.${k}`)}` : t(`sets.types.${k}`, { n: counts.get(k)! })))
    .join(" · ");
}

export function countLabel(t: ReturnType<typeof useT>, n: number) {
  return n === 1 ? t("sets.count_1") : t("sets.count", { n });
}


export function reasonText(t: ReturnType<typeof useT>, r: Reason, o: { loaders: string[]; mcRange: [string, string] | null; mc: string; loader: LoaderKind; message?: string | null }) {
  switch (r) {
    case "other_loader":
      return o.loaders.length ? t("apply.reason.other_loader", { loaders: o.loaders.map(prettyLoader).join(", ") }) : t("apply.reason.other_loader_none", { loader: loaderNames[o.loader] });
    case "other_mc":
      return t("apply.reason.other_mc", { mc: o.mc, range: o.mcRange ? (o.mcRange[0] === o.mcRange[1] ? o.mcRange[0] : `${o.mcRange[0]} – ${o.mcRange[1]}`) : "–" });
    case "failed":
      return o.message ? `${t("apply.reason.failed")}: ${o.message}` : t("apply.reason.failed");
    default:
      return t(`apply.reason.${r}`);
  }
}

export { copyText } from "@/components/content/util";

// ------------------------------------------------------------------ Globale Dialoge (Host in Shell)

interface DialogState {
  /** Vorschau + Installation */
  apply: { instanceId: string; setIds: string[]; only?: string[] } | null;
  /** „Aus Instanz“: neues Set (`targetSetId` leer) oder in bestehendes Set übernehmen */
  fromInstance: { instanceId: string | null; targetSetId?: string } | null;
  importOpen: boolean;
  /** Neues Set: danach zum Editor (`then`: Ansicht im Editor) */
  createOpen: boolean;
}

export const useSetDialogs = create<DialogState>(() => ({ apply: null, fromInstance: null, importOpen: false, createOpen: false }));

export const openApplySets = (instanceId: string, setIds: string[], only?: string[]) => useSetDialogs.setState({ apply: { instanceId, setIds, only } });
export const openSetFromInstance = (instanceId: string | null, targetSetId?: string) => useSetDialogs.setState({ fromInstance: { instanceId, targetSetId } });
export const openImportSet = () => useSetDialogs.setState({ importOpen: true });
export const openCreateSet = () => useSetDialogs.setState({ createOpen: true });
