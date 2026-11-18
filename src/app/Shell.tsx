// App-Rahmen: Seitenleiste und Titelleiste bilden einen ruhigen, durchgehenden Rahmen (ohne Trennlinien);
// die Inhaltsfläche liegt eine Stufe heller darin (Ecke oben links folgt der Einstellung „Ecken“).
// Seitenleiste: Navigation, zuletzt gespielte Instanzen, Einstellungen, Account.
// Titelleiste: Zurück/Vor, Brotkrumen, laufende Spiele, Aufgaben, Fensterknöpfe.
import { Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, Compass, Copy, Home, Images, LibraryBig, Minus, Plus, Server as ServerIcon, Settings as SettingsIcon, Shirt, Sparkles, Square, Users, X } from "lucide-react";
import { memo, useEffect, useState, type ReactNode } from "react";
import { ContextMenu, Spinner, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { isRunning, useGameStore, useInstance, useInstances, useInstanceTasks, useServer, useServerStore } from "@/lib/queries";
import { ServerDialogs } from "@/features/servers/ServerDialogs";
import { instanceAccent } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { Logo3D } from "@/components/Logo3D";
import { InstanceContextMenuContent } from "@/components/instance/InstanceMenu";
import { killInstance, openNewInstance } from "@/components/instance/actions";
import { InstanceDialogs } from "@/features/instances/InstanceDialogs";
import { TaskDock } from "./TaskDock";
import { UpdateButton } from "./UpdateNotice";
import { AccountChip } from "./AccountChip";
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

// ------------------------------------------------------------------ Icon-Leiste

function RailButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} side="right">
      <button
        aria-label={label}
        onClick={onClick}
        className={cn(
          "relative grid h-10 w-10 place-items-center rounded-ctl transition-colors duration-100",
          active ? "bg-white/[.08] text-text" : "text-muted hover:bg-white/[.05] hover:text-text",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const RailInstance = memo(function RailInstance({ instance: i, active }: { instance: Instance; active: boolean }) {
  const nav = useNavigate();
  const running = useGameStore((s) => isRunning(s.states[i.id]));
  const busy = useInstanceTasks(i.id).length > 0;
  return (
    <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
      <div>
        <Tooltip content={i.name} side="right">
          <button
            aria-label={i.name}
            onClick={() => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } })}
            className={cn("relative grid h-10 w-10 place-items-center transition-opacity duration-100", active ? "opacity-100" : "opacity-75 hover:opacity-100")}
          >
            <InstanceIcon icon={i.icon} accent={instanceAccent(i.id, i.accent)} size={34} className={cn(active && "shadow-[0_0_0_2px_var(--frame),0_0_0_3.5px_rgb(255_255_255/.35)]")} />
            {(running || busy) && (
              <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-dot border-2 border-[var(--tone-frame)]", running ? "bg-ok" : "bg-warn")} />
            )}
          </button>
        </Tooltip>
      </div>
    </ContextMenu>
  );
});

function Rail() {
  const t = useT();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: instances = [] } = useInstances();
  const recent = instances.slice(0, 8);
  const at = (p: string) => path === p || path.startsWith(p + "/");
  const serversRunning = useServerStore((s) => Object.values(s.statuses).some((x) => x.state === "running"));
  const vibe = useVibe();
  const socialBadge = useSocialBadge();
  const settingsOpen = useSettingsDialog((s) => s.open);
  return (
    <nav className="flex w-[var(--rail-w)] shrink-0 flex-col items-center gap-1 bg-bg py-2">
      <Tooltip content="Vibe Launcher" side="right">
        <button aria-label="Vibe Launcher" onClick={() => nav({ to: "/" })} className="mb-1 grid h-10 w-10 place-items-center">
          <Logo3D size={34} speed={0} hoverSpin float={false} interactive={false} />
        </button>
      </Tooltip>
      <RailButton label={t("nav.home")} active={path === "/"} onClick={() => nav({ to: "/" })}>
        <Home size={20} />
      </RailButton>
      <RailButton label={t("nav.instances")} active={path === "/instances"} onClick={() => nav({ to: "/instances" })}>
        <LibraryBig size={20} />
      </RailButton>
      <RailButton label={t("nav.servers")} active={at("/servers")} onClick={() => nav({ to: "/servers" })}>
        <ServerIcon size={20} />
        {serversRunning && <span className="absolute bottom-2 right-2 h-2 w-2 rounded-dot bg-ok shadow-[0_0_0_2px_var(--tone-frame)]" />}
      </RailButton>
      {vibe.social && (
        <RailButton label={t("nav.social")} active={at("/social")} onClick={() => nav({ to: "/social", search: {} })}>
          <Users size={20} />
          {socialBadge > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-pill bg-brand px-1 text-[9.5px] font-bold leading-none text-[var(--ui-on-accent)] shadow-[0_0_0_2px_var(--tone-frame)]">
              {socialBadge > 9 ? "9+" : socialBadge}
            </span>
          )}
        </RailButton>
      )}
      <RailButton label={t("nav.discover")} active={at("/discover") || at("/project")} onClick={() => nav({ to: "/discover" })}>
        <Compass size={20} />
      </RailButton>
      <RailButton label={t("nav.skins")} active={path === "/skins"} onClick={() => nav({ to: "/skins" })}>
        <Shirt size={20} />
      </RailButton>
      <RailButton label={t("nav.cosmetics")} active={at("/cosmetics")} onClick={() => nav({ to: "/cosmetics" })}>
        <Sparkles size={20} />
      </RailButton>
      <RailButton label={t("nav.screenshots")} active={path === "/screenshots"} onClick={() => nav({ to: "/screenshots" })}>
        <Images size={20} />
      </RailButton>
      <div className="my-1.5 h-px w-6 bg-line2" />
      <div className="scroll flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 py-0.5 [scrollbar-gutter:auto] [&::-webkit-scrollbar]:w-0">
        {recent.map((i) => (
          <RailInstance key={i.id} instance={i} active={path === `/instances/${i.id}`} />
        ))}
        <Tooltip content={t("rail.new_instance")} side="right">
          <button
            aria-label={t("rail.new_instance")}
            onClick={openNewInstance}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl text-dim transition-colors duration-100 hover:bg-white/[.05] hover:text-text"
          >
            <Plus size={18} />
          </button>
        </Tooltip>
      </div>
      <div className="my-1.5 h-px w-6 bg-line2" />
      <RailButton label={t("nav.settings")} active={settingsOpen} onClick={() => openSettings()}>
        <SettingsIcon size={20} />
      </RailButton>
      <AccountChip />
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
              {preparing ? <Spinner size={10} className="text-warn" /> : <span className="h-2 w-2 rounded-dot bg-ok shadow-[0_0_8px_var(--color-ok)]" />}
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

function WindowControls() {
  const t = useT();
  const [max, setMax] = useState(false);
  useEffect(() => {
    const w = getCurrentWindow();
    w.isMaximized().then(setMax).catch(() => {});
    const un = w.onResized(() => w.isMaximized().then(setMax).catch(() => {}));
    return () => {
      un.then((f) => f());
    };
  }, []);
  const btn = "grid h-full w-[46px] place-items-center text-muted transition-colors duration-100 hover:bg-white/[.07] hover:text-text";
  return (
    <div className="flex h-full">
      <button aria-label={t("window.minimize")} className={btn} onClick={() => getCurrentWindow().minimize()}>
        <Minus size={16} strokeWidth={1.5} />
      </button>
      <button aria-label={t("window.maximize")} className={btn} onClick={() => getCurrentWindow().toggleMaximize()}>
        {max ? <Copy size={13} strokeWidth={1.5} className="-scale-x-100" /> : <Square size={13} strokeWidth={1.5} />}
      </button>
      <button aria-label={t("window.close")} className={cn(btn, "hover:bg-[#e81123] hover:text-white")} onClick={() => getCurrentWindow().close()}>
        <X size={17} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function Topbar() {
  const t = useT();
  const router = useRouter();
  const title = usePageTitle();
  const navBtn = "grid h-7 w-7 place-items-center rounded-ctl text-dim transition-colors duration-100 hover:bg-white/[.06] hover:text-text";
  return (
    <header data-tauri-drag-region className="flex h-[var(--titlebar-h)] shrink-0 items-center bg-bg pl-2">
      <div className="flex items-center gap-0.5">
        <button aria-label={t("common.back")} className={navBtn} onClick={() => router.history.back()}>
          <ChevronLeft size={18} />
        </button>
        <button aria-label={t("rail.forward")} className={navBtn} onClick={() => router.history.forward()}>
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
      <AppearanceHost />
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <div className="flex min-h-0 flex-1">
          <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-panel bg-panel shadow-[inset_1px_1px_0_rgb(255_255_255/.035)]">
            <ErrorBoundary key={path}>
              <Outlet />
            </ErrorBoundary>
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
    </div>
  );
}
