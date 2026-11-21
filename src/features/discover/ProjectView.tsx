// Projektansicht (nach dem Vorbild von Modrinth): Kopf mit Icon, Name, Autor, Kennzahlen, Loader/Versionen und
// auffälligem Installieren-Knopf, Reiter Beschreibung / Galerie / Versionen, rechts eine Seitenleiste mit Details.
// Wird im Overlay über „Entdecken“ und im Server-Plugin-Overlay genutzt (Installieren-Knopf kommt als Slot).
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Tabs } from "@/components/ui";
import { Lightbox } from "@/components/ui/Lightbox";
import { useT } from "@/i18n";
import type { Instance, ProjectDetails, Source } from "@/lib/types";
import { ManualBadge } from "@/components/content/ManualBadge";
import { VersionsTab } from "./VersionsTab";
import { Description, Gallery } from "./project/Description";
import { Header } from "./project/Header";
import { InfoSidebar } from "./project/InfoSidebar";
import type { ViewProject } from "./project/types";

export type { ViewProject, ViewSource } from "./project/types";
export { ProjectViewSkeleton } from "./project/ProjectViewSkeleton";

type Tab = "description" | "gallery" | "versions";

const MODRINTH_LINK = /^https?:\/\/(?:www\.)?modrinth\.com\/(?:mod|plugin|resourcepack|shader|datapack|modpack|project)\/([\w.-]+)\/?(?:[?#].*)?$/i;

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
