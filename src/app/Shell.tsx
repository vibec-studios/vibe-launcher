// App-Rahmen im Stil der Modrinth App (eckig, Vibe-Farben):
// schmale Icon-Leiste links (Navigation, Instanzen, Einstellungen, Account),
// kompakte Topbar (Zurück/Vor, Titel, laufende Spiele, Aufgaben, Fensterknöpfe), Inhaltsfläche.
import { Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, Compass, Copy, Home, Images, LibraryBig, Minus, Plus, Server as ServerIcon, Settings as SettingsIcon, Shirt, Square, X } from "lucide-react";
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

// ------------------------------------------------------------------ Icon-Leiste

function RailButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} side="right">
      <button
        aria-label={label}
        onClick={onClick}
        className={cn(
          "relative grid h-10 w-10 place-items-center transition-colors duration-100",
          active ? "bg-surface3 text-white" : "text-muted hover:bg-surface2 hover:text-white",
        )}
      >
        {active && <span className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] bg-brand" />}
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
            className={cn("relative grid h-10 w-10 place-items-center transition-opacity duration-100", active ? "opacity-100" : "opacity-80 hover:opacity-100")}
          >
            {active && <span className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] bg-brand" />}
            <InstanceIcon icon={i.icon} accent={instanceAccent(i.id, i.accent)} size={36} />
            {(running || busy) && (
              <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 border-2 border-black", running ? "bg-ok" : "bg-warn")} />
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
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-line bg-black py-2">
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
        {serversRunning && <span className="absolute bottom-1.5 right-1.5 h-2 w-2 border border-black bg-ok" />}
      </RailButton>
      <RailButton label={t("nav.discover")} active={at("/discover") || at("/project")} onClick={() => nav({ to: "/discover" })}>
        <Compass size={20} />
      </RailButton>
      <RailButton label={t("nav.skins")} active={path === "/skins"} onClick={() => nav({ to: "/skins" })}>
        <Shirt size={20} />
      </RailButton>
      <RailButton label={t("nav.screenshots")} active={path === "/screenshots"} onClick={() => nav({ to: "/screenshots" })}>
        <Images size={20} />
      </RailButton>
      <div className="my-1.5 h-px w-8 bg-line" />
      <div className="scroll flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 [scrollbar-gutter:auto] [&::-webkit-scrollbar]:w-0">
        {recent.map((i) => (
          <RailInstance key={i.id} instance={i} active={path === `/instances/${i.id}`} />
        ))}
        <Tooltip content={t("rail.new_instance")} side="right">
          <button
            aria-label={t("rail.new_instance")}
            onClick={openNewInstance}
            className="grid h-10 w-10 shrink-0 place-items-center border border-dashed border-line2 text-muted transition-colors duration-100 hover:border-brand hover:text-white"
          >
            <Plus size={18} />
          </button>
        </Tooltip>
      </div>
      <div className="my-1.5 h-px w-8 bg-line" />
      <RailButton label={t("nav.settings")} active={path === "/settings"} onClick={() => nav({ to: "/settings" })}>
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
        <span className="text-muted">{t("nav.servers")}</span>
        <ChevronRight size={14} className="text-dim" />
        <span className="truncate">{server?.name ?? serverId}</span>
      </>
    );
  if (instId)
    return (
      <>
        <span className="text-muted">{t("nav.instances")}</span>
        <ChevronRight size={14} className="text-dim" />
        <span className="truncate">{inst?.name ?? instId}</span>
      </>
    );
  if (path.startsWith("/discover")) return t("nav.discover");
  if (path.startsWith("/project/"))
    return (
      <>
        <span className="text-muted">{t("nav.discover")}</span>
        <ChevronRight size={14} className="text-dim" />
        <span className="text-muted">{t("rail.project")}</span>
      </>
    );
  if (path === "/accounts") return t("nav.accounts");
  if (path === "/settings") return t("nav.settings");
  if (path === "/stats") return t("stats.title");
  if (path === "/skins") return t("nav.skins");
  if (path === "/screenshots") return t("nav.screenshots");
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
          <div key={i.id} className="flex h-8 items-center border border-line bg-surface2">
            <button
              className="flex h-full items-center gap-2 pl-2 pr-2.5 text-[13px] text-text hover:text-white"
              onClick={() => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "logs" } })}
            >
              {preparing ? <Spinner size={10} className="text-warn" /> : <span className="h-2 w-2 bg-ok" />}
              <span className="max-w-[160px] truncate">{i.name}</span>
            </button>
            <Tooltip content={t("common.stop")} side="bottom">
              <button aria-label={t("common.stop")} onClick={() => killInstance(i)} className="grid h-full w-8 place-items-center border-l border-line text-muted hover:bg-danger hover:text-black">
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
  const btn = "grid h-full w-[46px] place-items-center text-muted transition-colors duration-100 hover:bg-white/[.07] hover:text-white";
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
  const navBtn = "grid h-8 w-8 place-items-center text-muted transition-colors duration-100 hover:bg-surface2 hover:text-white";
  return (
    <header data-tauri-drag-region className="flex h-12 shrink-0 items-center border-b border-line bg-black pl-3">
      <div className="flex items-center gap-0.5">
        <button aria-label={t("common.back")} className={navBtn} onClick={() => router.history.back()}>
          <ChevronLeft size={18} />
        </button>
        <button aria-label={t("rail.forward")} className={navBtn} onClick={() => router.history.forward()}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div data-tauri-drag-region className="ml-3 flex min-w-0 items-center gap-2 text-[14px] font-semibold text-white">
        {title}
      </div>
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex items-center gap-2 pr-2">
        <UpdateButton />
        <RunningGames />
        <TaskDock />
      </div>
      <div className="h-6 w-px bg-line" />
      <WindowControls />
    </header>
  );
}

// ------------------------------------------------------------------ Rahmen

export function Shell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex h-full">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="relative min-h-0 flex-1 bg-panel">
          <ErrorBoundary key={path}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <InstanceDialogs />
      <ServerDialogs />
    </div>
  );
}
