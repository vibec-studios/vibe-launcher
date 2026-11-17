// App-Rahmen: eigene Titelleiste im Stil der Website-Navigation + Seiteninhalt.
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Settings as SettingsIcon, Square, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { IconButton, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { TaskDock } from "./TaskDock";
import { AccountChip } from "./AccountChip";
import { ErrorBoundary } from "./ErrorBoundary";

function NavLink({ to, children, exact }: { to: string; children: ReactNode; exact?: boolean }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = exact ? path === to : path === to || path.startsWith(to + "/") || (to === "/discover" && path.startsWith("/project/"));
  return (
    <Link
      to={to}
      className={cn(
        "no-drag flex h-full items-center px-1 text-[13px] transition-colors duration-150",
        active ? "text-white shadow-[inset_0_-2px_0_var(--color-brand)]" : "text-muted hover:text-white",
      )}
    >
      {children}
    </Link>
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
  const btn = "no-drag grid h-full w-[46px] place-items-center text-muted transition-colors duration-100 hover:bg-white/[.07] hover:text-white";
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

export function Titlebar() {
  const t = useT();
  const nav = useNavigate();
  const settingsActive = useRouterState({ select: (s) => s.location.pathname === "/settings" });
  return (
    <header
      className="drag relative z-40 flex h-[48px] shrink-0 items-stretch border-b border-line bg-black/85 backdrop-blur-md"
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest(".no-drag")) return;
        getCurrentWindow().toggleMaximize();
      }}
    >
      <Link to="/" className="no-drag flex items-center gap-2.5 pl-5 pr-7">
        <img src="/logo.svg" alt="" width={20} height={20} draggable={false} />
        <span className="font-display text-[14px] font-bold uppercase tracking-[.02em]">Vibe Launcher</span>
      </Link>
      <nav className="flex items-stretch gap-6">
        <NavLink to="/" exact>
          {t("nav.home")}
        </NavLink>
        <NavLink to="/instances">{t("nav.instances")}</NavLink>
        <NavLink to="/discover">{t("nav.discover")}</NavLink>
      </nav>
      <div className="flex-1" />
      <div className="no-drag flex items-center gap-2 pr-3">
        <TaskDock />
        <AccountChip />
        <Tooltip content={t("nav.settings")} side="bottom">
          <IconButton
            label={t("nav.settings")}
            size="sm"
            active={settingsActive}
            className={settingsActive ? "" : "border-transparent hover:border-line2"}
            onClick={() => nav({ to: "/settings" })}
          >
            <SettingsIcon size={16} />
          </IconButton>
        </Tooltip>
      </div>
      <div className="w-px self-stretch bg-line" />
      <WindowControls />
    </header>
  );
}

export function Shell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex h-full flex-col">
      <Titlebar />
      <main className="relative min-h-0 flex-1">
        <ErrorBoundary key={path}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
