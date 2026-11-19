// App-Rahmen: Seitenleiste und Titelleiste bilden einen ruhigen, durchgehenden Rahmen (ohne Trennlinien);
// die Inhaltsfläche liegt eine Stufe heller darin (Ecke oben links folgt der Einstellung „Ecken“).
// Seitenleiste: Navigation, zuletzt gespielte Instanzen, Einstellungen.
// Titelleiste: Zurück/Vor, Brotkrumen, laufende Spiele, Aufgaben, Freunde, Konto-Menü, Fensterknöpfe.
// Simple-Modus (src/lib/mode.tsx): feste, kurze Navigation mit Beschriftung; Onboarding/Einführung hängen hier.
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { BEDROCK_COLOR } from "@/features/bedrock/parts";
import { ChevronLeft, ChevronRight, Compass, Home, Images, LibraryBig, Plus, Server as ServerIcon, Settings as SettingsIcon, Shirt, Sparkles, Square, Users } from "lucide-react";
import { memo, type ReactNode } from "react";
import { ContextMenu, Spinner, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { isRunning, useGameStore, useInstance, useInstances, useInstanceTasks, useServer, useServerStore } from "@/lib/queries";
import { ServerDialogs } from "@/features/servers/ServerDialogs";
import { instanceAccent } from "@/lib/format";
import type { Instance, NavKey } from "@/lib/types";
import { useLiveAppearance } from "@/lib/appearance";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { Logo3D } from "@/components/Logo3D";
import { InstanceContextMenuContent } from "@/components/instance/InstanceMenu";
import { killInstance, openNewInstance } from "@/components/instance/actions";
import { InstanceDialogs } from "@/features/instances/InstanceDialogs";
import { TaskDock } from "./TaskDock";
import { UpdateButton } from "./UpdateNotice";
import { NoticeBar } from "./Notices";
import { AccountMenu } from "./AccountMenu";
import { ModeHost, useSimple } from "@/lib/mode";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { SimpleTour } from "@/features/onboarding/SimpleTour";
import { SimpleModeHint } from "@/features/onboarding/SimpleModeHint";
import { ImportSettingsHint, SettingsReviewDialog } from "@/features/import/SettingsOffer";
import { ErrorBoundary } from "./ErrorBoundary";
import { useVibe } from "@/lib/vibe";
import { VibeBridge } from "@/features/social/VibeBridge";
import { CosmeticsBridge } from "@/features/cosmetics/CosmeticsBridge";
import { SocialDialogs } from "@/features/social/dialogs";
import { FriendsPanel, FriendsPanelToggle } from "@/features/social/FriendsPanel";
import { useSocialBadge } from "@/features/social/hooks";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { openSettings, useSettingsDialog } from "@/features/settings/store";
import { AppearanceHost } from "./AppearanceHost";
import { ModSetsHost } from "@/features/modsets/dialogs";
import { goBack, goForward } from "./backNav";
import { WindowControls } from "./WindowControls";

// ------------------------------------------------------------------ Seitenleiste
// Kompakt (nur Icons, Standard) oder breit mit Beschriftung; Reihenfolge/Sichtbarkeit der Einträge und die
// Instanz-Liste kommen aus der Darstellung (Einstellungen → Darstellung → Seitenleiste).

function RailButton({
  label,
  active,
  wide,
  onClick,
  children,
  tour,
}: {
  label: string;
  active?: boolean;
  wide: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Ziel für die Einführungs-Bubbles (SimpleTour) */
  tour?: string;
}) {
  return (
    <Tooltip content={wide ? null : label} side="right">
      <button
        data-tour={tour}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={cn(
          "relative flex h-10 shrink-0 items-center rounded-ctl transition-colors duration-100",
          wide ? "w-full gap-3 px-3 text-[13.5px] font-medium" : "w-10 justify-center",
          active ? "bg-white/[.08] text-brand" : "text-muted hover:bg-white/[.05] hover:text-text",
        )}
      >
        {children}
        {wide && <span className={cn("truncate", active && "text-text")}>{label}</span>}
      </button>
    </Tooltip>
  );
}

const RailInstance = memo(function RailInstance({ instance: i, active, wide }: { instance: Instance; active: boolean; wide: boolean }) {
  const nav = useNavigate();
  const running = useGameStore((s) => isRunning(s.states[i.id]));
  const busy = useInstanceTasks(i.id).length > 0;
  const simple = useSimple();
  return (
    <ContextMenu disabled={simple} content={<InstanceContextMenuContent instance={i} />}>
      <div className={wide ? "w-full" : undefined}>
        <Tooltip content={wide ? null : i.bedrock ? `${i.name} · Bedrock` : i.name} side="right">
          <button
            aria-label={i.name}
            onClick={() => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } })}
            className={cn(
              "relative flex shrink-0 items-center transition-[opacity,background-color] duration-100",
              wide ? "h-9 w-full gap-2.5 rounded-ctl px-2 text-left hover:bg-white/[.05]" : "h-10 w-10 justify-center",
              active ? "opacity-100" : "opacity-75 hover:opacity-100",
              wide && active && "bg-white/[.06]",
            )}
          >
            <span className="relative">
              <InstanceIcon
                icon={i.icon}
                accent={instanceAccent(i.id, i.accent)}
                size={wide ? 26 : 34}
                className={cn(active && !wide && "outline outline-1 outline-offset-2 outline-white/40")}
              />
              {(running || busy) && (
                <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-dot border-2 border-[var(--tone-frame)]", running ? "bg-ok" : "bg-warn")} />
              )}
            </span>
            {wide && <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{i.name}</span>}
            {wide && i.bedrock && (
              <span className="shrink-0 text-[10.5px] font-bold tracking-wide" style={{ color: BEDROCK_COLOR }} title="Minecraft Bedrock">
                BE
              </span>
            )}
          </button>
        </Tooltip>
      </div>
    </ContextMenu>
  );
});

type NavDef = { icon: ReactNode; label: string; go: (nav: ReturnType<typeof useNavigate>) => void; match: (path: string, at: (p: string) => boolean) => boolean };

const NAV: Record<NavKey, NavDef> = {
  home: { icon: <Home size={20} />, label: "nav.home", go: (nav) => nav({ to: "/" }), match: (p) => p === "/" },
  instances: { icon: <LibraryBig size={20} />, label: "nav.instances", go: (nav) => nav({ to: "/instances" }), match: (p) => p === "/instances" || p === "/modsets" },
  servers: { icon: <ServerIcon size={20} />, label: "nav.servers", go: (nav) => nav({ to: "/servers" }), match: (_, at) => at("/servers") },
  social: { icon: <Users size={20} />, label: "nav.social", go: (nav) => nav({ to: "/social", search: {} }), match: (_, at) => at("/social") },
  discover: { icon: <Compass size={20} />, label: "nav.discover", go: (nav) => nav({ to: "/discover" }), match: (_, at) => at("/discover") || at("/project") },
  skins: { icon: <Shirt size={20} />, label: "nav.skins", go: (nav) => nav({ to: "/skins" }), match: (p) => p === "/skins" },
  cosmetics: { icon: <Sparkles size={20} />, label: "nav.cosmetics", go: (nav) => nav({ to: "/cosmetics" }), match: (_, at) => at("/cosmetics") },
  screenshots: { icon: <Images size={20} />, label: "nav.screenshots", go: (nav) => nav({ to: "/screenshots" }), match: (p) => p === "/screenshots" },
};

/** Simple-Modus: feste, kurze Navigation (Skins übers Konto-Menü; Server, Screenshots und Statistiken nur im
 *  Expert-Modus – sie setzen Technik voraus oder sind für den Einstieg nicht nötig). */
const SIMPLE_NAV: NavKey[] = ["home", "instances", "discover", "social", "cosmetics"];

/** Logo oben: 3D-Robbe – im Winter-Theme mit Schal (Maskottchen, Logo3D folgt dem Theme selbst). */
function RailLogo({ wide }: { wide: boolean }) {
  const nav = useNavigate();
  return (
    <Tooltip content={wide ? null : "Vibe Launcher"} side="right">
      <button
        aria-label="Vibe Launcher"
        onClick={() => nav({ to: "/" })}
        className={cn("mb-1 flex h-10 shrink-0 items-center", wide ? "w-full gap-2.5 px-1.5" : "w-10 justify-center")}
      >
        <Logo3D size={34} speed={0} hoverSpin float={false} interactive={false} />
        {wide && <span className="truncate text-[14px] font-bold tracking-[-0.01em] text-text">Vibe Launcher</span>}
      </button>
    </Tooltip>
  );
}

function Rail() {
  const t = useT();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: instances = [] } = useInstances();
  const sidebar = useLiveAppearance((s) => s.a.sidebar);
  const simple = useSimple();
  const wide = sidebar.mode === "wide" || simple;
  const recent = sidebar.instances ? instances.slice(0, 8) : [];
  const at = (p: string) => path === p || path.startsWith(p + "/");
  const serversRunning = useServerStore((s) => Object.values(s.statuses).some((x) => x.state === "running"));
  const vibe = useVibe();
  const socialBadge = useSocialBadge();
  const settingsOpen = useSettingsDialog((s) => s.open);
  const keys = (simple ? SIMPLE_NAV : sidebar.order.filter((k) => !sidebar.hidden.includes(k))).filter(
    (k) => (k !== "social" || vibe.social) && (k !== "cosmetics" || vibe.enabled),
  );
  const sep = <div className={cn("my-1.5 h-px shrink-0 bg-line2", wide ? "mx-1.5" : "w-6")} />;
  return (
    <nav className={cn("flex w-[var(--rail-w)] shrink-0 flex-col gap-1 bg-bg py-2", wide ? "items-stretch px-2.5" : "items-center")}>
      <RailLogo wide={wide} />
      {keys.map((k) => {
        const n = NAV[k];
        return (
          <RailButton key={k} wide={wide} label={t(n.label)} active={n.match(path, at)} onClick={() => n.go(nav)} tour={k}>
            {n.icon}
            {k === "servers" && serversRunning && (
              <span className={cn("absolute h-2 w-2 rounded-dot bg-ok shadow-[0_0_0_2px_var(--tone-frame)]", wide ? "right-3 top-1/2 -translate-y-1/2" : "bottom-2 right-2")} />
            )}
            {k === "social" && socialBadge > 0 && (
              <span
                className={cn(
                  "absolute grid h-4 min-w-4 place-items-center rounded-pill bg-brand px-1 text-[9.5px] font-bold leading-none text-[var(--ui-on-accent)] shadow-[0_0_0_2px_var(--tone-frame)]",
                  wide ? "right-2.5 top-1/2 -translate-y-1/2" : "-right-0.5 -top-0.5",
                )}
              >
                {socialBadge > 9 ? "9+" : socialBadge}
              </span>
            )}
          </RailButton>
        );
      })}
      {sep}
      <div
        className={cn(
          "scroll flex min-h-0 w-full flex-1 flex-col py-0.5 [scrollbar-gutter:auto] [&::-webkit-scrollbar]:w-0",
          wide ? "items-stretch gap-0.5" : "items-center gap-1.5",
        )}
      >
        {wide && recent.length > 0 && <div className="px-2 pb-1 pt-0.5 text-[11.5px] font-semibold text-dim">{t("nav.recent")}</div>}
        {recent.map((i) => (
          <RailInstance key={i.id} instance={i} wide={wide} active={path === `/instances/${i.id}`} />
        ))}
        <Tooltip content={wide ? null : t("rail.new_instance")} side="right">
          <button
            aria-label={t("rail.new_instance")}
            onClick={openNewInstance}
            className={cn(
              "flex shrink-0 items-center rounded-ctl text-dim transition-colors duration-100 hover:bg-white/[.05] hover:text-text",
              wide ? "h-9 w-full gap-2.5 px-2 text-[13px] font-medium" : "h-10 w-10 justify-center",
            )}
          >
            <span className={cn("grid place-items-center", wide && "h-[26px] w-[26px]")}>
              <Plus size={18} />
            </span>
            {wide && <span className="truncate">{t("rail.new_instance")}</span>}
          </button>
        </Tooltip>
      </div>
      {sep}
      <RailButton wide={wide} label={t("nav.settings")} active={settingsOpen} onClick={() => openSettings()}>
        <SettingsIcon size={20} />
      </RailButton>
    </nav>
  );
}

// ------------------------------------------------------------------ Topbar

function usePageTitle(): ReactNode {
  const t = useT();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const instId = path.startsWith("/instances/") ? decodeURIComponent(path.split("/")[2] ?? "") : "";
  const { data: inst } = useInstance(instId);
  const serverId = path.startsWith("/servers/") ? decodeURIComponent(path.split("/")[2] ?? "") : "";
  const { data: server } = useServer(serverId);
  if (path === "/") return t("nav.home");
  if (path === "/instances") return t("nav.instances");
  if (path === "/modsets")
    return (
      <>
        <span className="font-medium text-muted">{t("nav.instances")}</span>
        <ChevronRight size={13} className="shrink-0 text-dim" />
        <span className="truncate">{t("nav.modsets")}</span>
      </>
    );
  if (path === "/servers") return t("nav.servers");
  if (serverId)
    return (
      <>
        <span className="font-medium text-muted">{t("nav.servers")}</span>
        <ChevronRight size={13} className="shrink-0 text-dim" />
        <span className="truncate">{server?.name ?? serverId}</span>
      </>
    );
  if (instId)
    return (
      <>
        <span className="font-medium text-muted">{t("nav.instances")}</span>
        <ChevronRight size={13} className="shrink-0 text-dim" />
        <span className="truncate">{inst?.name ?? instId}</span>
      </>
    );
  if (path.startsWith("/discover")) return t("nav.discover");
  if (path.startsWith("/project/"))
    return (
      <>
        <span className="font-medium text-muted">{t("nav.discover")}</span>
        <ChevronRight size={13} className="shrink-0 text-dim" />
        <span className="text-muted">{t("rail.project")}</span>
      </>
    );
  if (path === "/accounts") return t("nav.accounts");
  if (path === "/stats") return t("stats.title");
  if (path === "/skins") return t("nav.skins");
  if (path === "/screenshots") return t("nav.screenshots");
  if (path === "/social") return t("nav.social");
  if (path === "/cosmetics") return t("nav.cosmetics");
  if (path === "/cosmetics/creator")
    return (
      <>
        <span className="font-medium text-muted">{t("nav.cosmetics")}</span>
        <ChevronRight size={13} className="shrink-0 text-dim" />
        <span>{t("cos.creator")}</span>
      </>
    );
  return null;
}

function RunningGames() {
  const t = useT();
  const nav = useNavigate();
  const states = useGameStore((s) => s.states);
  const { data: instances = [] } = useInstances();
  const running = instances.filter((i) => isRunning(states[i.id]));
  if (!running.length) return null;
  return (
    <div className="flex items-center gap-1.5">
      {running.slice(0, 2).map((i) => {
        const preparing = states[i.id]?.state === "preparing";
        return (
          <div key={i.id} className="flex h-8 items-center overflow-hidden rounded-ctl bg-surface2">
            <button
              className="flex h-full items-center gap-2 pl-2.5 pr-2.5 text-[13px] font-medium text-text hover:bg-white/[.04]"
              onClick={() => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "logs" } })}
            >
              {preparing ? <Spinner size={10} className="text-warn" /> : <span className="h-2 w-2 rounded-dot bg-ok" />}
              <span className="max-w-[160px] truncate">{i.name}</span>
            </button>
            <Tooltip content={t("common.stop")} side="bottom">
              <button aria-label={t("common.stop")} onClick={() => killInstance(i)} className="grid h-full w-8 place-items-center text-muted hover:bg-danger hover:text-black">
                <Square size={11} fill="currentColor" />
              </button>
            </Tooltip>
          </div>
        );
      })}
      {running.length > 2 && <span className="text-[12px] text-dim">+{running.length - 2}</span>}
    </div>
  );
}

function Topbar() {
  const t = useT();
  const title = usePageTitle();
  const navBtn = "grid h-7 w-7 place-items-center rounded-ctl text-dim transition-colors duration-100 hover:bg-white/[.06] hover:text-text";
  return (
    <header data-tauri-drag-region className="flex h-[var(--titlebar-h)] shrink-0 items-center bg-bg pl-2">
      <div className="flex items-center gap-0.5">
        <button aria-label={t("common.back")} className={navBtn} onClick={goBack}>
          <ChevronLeft size={18} />
        </button>
        <button aria-label={t("rail.forward")} className={navBtn} onClick={goForward}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div data-tauri-drag-region className="ml-2 flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-text">
        {title}
      </div>
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex items-center gap-1.5 pr-3">
        <UpdateButton />
        <RunningGames />
        <TaskDock />
        <FriendsPanelToggle />
        <span className="mx-0.5 h-5 w-px bg-line2" aria-hidden />
        <AccountMenu />
      </div>
      <WindowControls />
    </header>
  );
}

// ------------------------------------------------------------------ Rahmen

export function Shell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex h-full">
      <ModeHost />
      <AppearanceHost />
      <ModSetsHost />
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <div className="flex min-h-0 flex-1">
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-panel bg-panel">
            <ErrorBoundary>
              <NoticeBar />
            </ErrorBoundary>
            <div className="relative min-h-0 flex-1">
              <ErrorBoundary key={path}>
                {/* Seitenwechsel-Animation (globals.css, „Bewegung“) – je Route neu gemountet */}
                <div className="vl-page">
                  <Outlet />
                </div>
              </ErrorBoundary>
            </div>
          </main>
          {path !== "/social" && (
            <ErrorBoundary>
              <FriendsPanel />
            </ErrorBoundary>
          )}
        </div>
      </div>
      <InstanceDialogs />
      <ServerDialogs />
      <VibeBridge />
      <CosmeticsBridge />
      <SocialDialogs />
      <SettingsDialog />
      <SimpleModeHint />
      <ErrorBoundary>
        <ImportSettingsHint />
        <SettingsReviewDialog />
      </ErrorBoundary>
      <SimpleTour />
      <Onboarding />
    </div>
  );
}
