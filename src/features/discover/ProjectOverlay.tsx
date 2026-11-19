// Projekt-Overlay: Projekte öffnen sich als großes Panel von rechts über der aktuellen Seite („Entdecken“,
// Server-Plugins), statt die Seite zu wechseln. Suche, Filter, Ergebnisse und Scrollposition bleiben dahinter erhalten.
//
// Entdecken: Zustand im Search-Param `?p=quelle:id`. Öffnen und Projekt-zu-Projekt-Navigation legen History-Einträge
// an (mit `pDepth` im History-State). „Zurück“ (Maus-Taste 3, Alt+Links, Zurück-Knopf) geht so erst zum vorigen
// Projekt und schließt dann das Overlay – die Entdecken-Seite wird dabei nie verlassen. Esc/X schließen ganz.
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useRouter, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ExternalLink, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ErrorState, IconButton, Tooltip, cn } from "@/components/ui";
import { interceptBack } from "@/app/backNav";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { qk, useJavaInstances } from "@/lib/queries";
import type { Source } from "@/lib/types";
import { openExternal } from "@/components/content/util";
import { InstallMenu } from "./InstallMenu";
import { ProjectView, ProjectViewSkeleton } from "./ProjectView";

const route = getRouteApi("/discover");

/** `quelle:id` -> Quelle + ID (Store-Quellen enthalten selbst einen Doppelpunkt). */
export function parseProjectParam(v: string): { source: Source; id: string } | null {
  const i = v.lastIndexOf(":");
  if (i <= 0 || i === v.length - 1) return null;
  const s = v.slice(0, i);
  const source: Source | null = s === "modrinth" || s === "curseforge" ? s : /^store:[\w-]+$/.test(s) ? (s as Source) : null;
  return source ? { source, id: v.slice(i + 1) } : null;
}

export function projectParam(source: Source, id: string) {
  return `${source}:${id}`;
}

/** Ist gerade ein anderes Popup (Dialog, Menü, Lightbox) offen? Dann gehört Esc diesem. */
function otherLayerOpen(sheet: HTMLElement | null) {
  const open = document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"], [role="listbox"]');
  return Array.from(open).some((el) => el !== sheet);
}

/** Gemerkte Scrollposition je Projekt (Zurück zum vorigen Projekt landet an derselben Stelle). */
const scrollPos = new Map<string, number>();

export function ProjectSheet({
  viewKey,
  canBack,
  onBack,
  onClose,
  pageUrl,
  pageLabel,
  children,
}: {
  /** Schlüssel des angezeigten Projekts (Scrollposition) */
  viewKey: string;
  canBack: boolean;
  onBack: () => void;
  onClose: () => void;
  pageUrl?: string | null;
  pageLabel?: string;
  children: ReactNode;
}) {
  const t = useT();
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // Maus-Zurück / Alt+Links / Zurück-Knopf: im Overlay zurück bzw. schließen
  useEffect(
    () =>
      interceptBack(() => {
        onBack();
        return true;
      }),
    [onBack],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || otherLayerOpen(sheet.current)) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fokus ins Panel (Tastatur-Scrollen), Scrollposition je Projekt
  useEffect(() => {
    sheet.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    el.scrollTop = scrollPos.get(viewKey) ?? 0;
    return () => {
      scrollPos.set(viewKey, el.scrollTop);
    };
  }, [viewKey]);

  return (
    <div className="absolute inset-0 z-30 flex justify-end">
      <div className="vl-sheet-backdrop absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={t("rail.project")}
        data-project-sheet=""
        tabIndex={-1}
        className="vl-sheet relative flex h-full w-[min(1120px,calc(100%-56px))] flex-col bg-panel shadow-e3 outline-none"
      >
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
          {canBack ? (
            <button
              onClick={onBack}
              className="inline-flex h-8 items-center gap-1 rounded-ctl pl-1.5 pr-2.5 text-[13px] font-semibold text-muted transition-colors hover:bg-white/[.06] hover:text-text"
            >
              <ChevronLeft size={16} />
              {t("common.back")}
            </button>
          ) : (
            <span className="pl-2 text-[12.5px] font-semibold text-dim">{t("rail.project")}</span>
          )}
          <div className="flex-1" />
          {pageUrl && (
            <button
              onClick={() => void openExternal(pageUrl)}
              className="inline-flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-white/[.06] hover:text-text"
            >
              <ExternalLink size={13} />
              {pageLabel}
            </button>
          )}
          <Tooltip content={t("project.close_hint")}>
            <IconButton label={t("common.close")} variant="ghost" size="sm" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </Tooltip>
        </div>
        <div ref={body} className="scroll min-h-0 flex-1">
          <div className="px-8 pb-12 pt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** Anzahl der Overlay-Einträge über der Entdecken-Seite (Projekt-Overlay) */
    pDepth?: number;
  }
}

/** Steuerung des Overlays auf der Entdecken-Seite. */
export function useProjectOverlayNav() {
  const navigate = route.useNavigate();
  const router = useRouter();
  const depth = useRouterState({ select: (s) => s.location.state.pDepth ?? 0 });
  const open = (source: Source, id: string) =>
    navigate({ search: (s) => ({ ...s, p: projectParam(source, id) }), state: (st) => ({ ...st, pDepth: depth + 1 }) });
  const close = () => {
    if (depth > 0) router.history.go(-depth);
    else navigate({ search: (s) => ({ ...s, p: undefined }), replace: true });
  };
  const back = () => {
    if (depth > 0) router.history.back();
    else close();
  };
  return { depth, open, close, back };
}

/** Overlay der Entdecken-Seite für `?p=quelle:id`. */
export function DiscoverProjectOverlay({ value, instanceId }: { value: string; instanceId?: string }) {
  const t = useT();
  const nav = useProjectOverlayNav();
  const parsed = parseProjectParam(value);
  const { data: instances } = useJavaInstances();
  const target = instanceId ? (instances?.find((i) => i.id === instanceId) ?? null) : null;
  const q = useQuery({
    queryKey: qk.project(parsed?.source ?? "modrinth", parsed?.id ?? ""),
    queryFn: () => api.contentProject(parsed!.source, parsed!.id),
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
      pageLabel={p ? t("project.open_on", { source: p.source === "curseforge" ? "CurseForge" : p.source === "modrinth" ? "Modrinth" : p.source.replace(/^store:/, "") }) : undefined}
    >
      {!parsed ? (
        <ErrorState error={t("project.invalid")} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} className={cn("rounded-card bg-surface")} />
      ) : !p ? (
        <ProjectViewSkeleton />
      ) : (
        <ProjectView
          key={value}
          p={p}
          target={target}
          onOpenProject={nav.open}
          install={<InstallMenu project={p} target={target && p.project_type !== "modpack" ? target : null} size="md" wide />}
        />
      )}
    </ProjectSheet>
  );
}
