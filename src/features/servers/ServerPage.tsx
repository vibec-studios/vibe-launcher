// Detailseite eines Servers: Kopf (Icon, Name, Version, Status, Steuerung) + Tabs
// (Konsole, Einstellungen, Spieler, Welten & Backups, Dateien, Verbindung).
import { useEffect, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, FolderOpen, Gamepad2, Info, MoreHorizontal, RotateCw, Skull, Wrench, X } from "lucide-react";
import { useServer, useServerStatus } from "@/lib/queries";
import type { Server } from "@/lib/types";
import type { ServerTab } from "@/app/router";
import { formatLoader, formatRelative } from "@/lib/format";
import { Button, DropdownMenu, ErrorState, IconButton, Skeleton, Tabs, Tooltip, cn } from "@/components/ui";
import { accentVars } from "@/components/instance/accent";
import { useT } from "@/i18n";
import { joinServer, killServer, openServerFolder, repairServer, restartServer, setServerIcon, useServerTask } from "./actions";
import { AddressChip, ServerDropdownContent, ServerIcon, ServerPowerButton, StatusLabel, serverAccent, useAddress } from "./parts";
import { ConsoleTab } from "./ConsoleTab";
import { ServerSettingsTab } from "./ServerSettingsTab";
import { PlayersTab } from "./PlayersTab";
import { ServerWorldsTab } from "./ServerWorldsTab";
import { ConnectionTab } from "./ConnectionTab";
import { ServerFilesTab } from "@/features/files";

const route = getRouteApi("/servers/$id");
const wrap = "w-full px-6";

function Banner({ tone, icon, title, text, action, onClose }: { tone: "danger" | "warn" | "info"; icon: React.ReactNode; title: string; text?: string; action?: React.ReactNode; onClose?: () => void }) {
  const t = useT();
  const cls = tone === "danger" ? "border-danger/30 bg-danger/[.08] text-danger" : tone === "warn" ? "border-warn/30 bg-warn/[.07] text-warn" : "border-line bg-surface text-accent";
  return (
    <div className={cn("shrink-0 border-b animate-fade-in", cls)}>
      <div className={cn(wrap, "flex items-center gap-3 py-2.5")}>
        <span className="shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-white">{title}</div>
          {text && <div className="truncate text-[12px] text-muted">{text}</div>}
        </div>
        {action}
        {onClose && (
          <IconButton label={t("common.close")} size="sm" className="border-transparent" onClick={onClose}>
            <X size={15} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function Banners({ server }: { server: Server }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const task = useServerTask(server.id);
  const crashKey = st?.state === "crashed" ? `${st.started_at}:${st.exit_code}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  return (
    <>
      {crashKey && dismissed !== crashKey && (
        <Banner
          tone="danger"
          icon={<AlertTriangle size={18} />}
          title={t("srv.crash.title")}
          text={st?.exit_code != null ? t("srv.crash.code", { code: st.exit_code }) : t("srv.crash.text")}
          onClose={() => setDismissed(crashKey)}
        />
      )}
      {st?.detached && st.state !== "stopped" && <Banner tone="info" icon={<Info size={18} />} title={t("srv.detached.title")} text={t("srv.detached.text")} />}
      {server.install_state === "failed" && !task && (
        <Banner
          tone="warn"
          icon={<AlertTriangle size={18} />}
          title={t("srv.install_failed.title")}
          text={t("srv.install_failed.text")}
          action={
            <Button size="sm" icon={<Wrench size={13} />} onClick={() => repairServer(server)}>
              {t("srv.repair")}
            </Button>
          }
        />
      )}
    </>
  );
}

function HeaderSkeleton() {
  return (
    <header className="shrink-0 border-b border-line">
      <div className={cn(wrap, "flex items-center gap-4 pb-3 pt-5")}>
        <Skeleton className="h-16 w-16" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-10 w-[136px]" />
      </div>
      <div className={cn(wrap, "flex h-11 items-center gap-6")}>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-3.5 w-16" />
        ))}
      </div>
    </header>
  );
}

function MetaLine({ server: s }: { server: Server }) {
  const t = useT();
  const st = useServerStatus(s.id);
  const running = st?.state === "running";
  const parts: React.ReactNode[] = [formatLoader(s.loader), `Minecraft ${s.mc_version}`];
  if (running) parts.push(t("srv.players_n", { n: st?.players.length ?? 0, max: st?.max_players ?? "–" }));
  else parts.push(s.last_started ? t("srv.meta.last", { when: formatRelative(s.last_started) }) : t("srv.meta.never"));
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted">
      <StatusLabel server={s} status={st} />
      {parts.map((p, n) => (
        <span key={n} className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-dim">·</span>
          {p}
        </span>
      ))}
    </div>
  );
}

function HeaderControls({ server }: { server: Server }) {
  const t = useT();
  const nav = useNavigate();
  const st = useServerStatus(server.id);
  const state = st?.state ?? "stopped";
  const active = state === "running" || state === "starting" || state === "stopping";
  const address = useAddress(server);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <AddressChip address={address} className="h-10 w-[220px]" />
      <ServerPowerButton server={server} className="h-10 min-w-[120px]" />
      {active && (
        <>
          <Tooltip content={t("srv.join")}>
            <IconButton label={t("srv.join")} className="h-10 w-10" disabled={state !== "running"} onClick={() => joinServer(server)}>
              <Gamepad2 size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip content={t("srv.restart")}>
            <IconButton label={t("srv.restart")} className="h-10 w-10" disabled={state !== "running" || st?.detached} onClick={() => restartServer(server)}>
              <RotateCw size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip content={t("srv.kill")}>
            <IconButton label={t("srv.kill")} className="h-10 w-10 hover:text-danger" onClick={() => killServer(server)}>
              <Skull size={16} />
            </IconButton>
          </Tooltip>
        </>
      )}
      <Tooltip content={t("common.open_folder")}>
        <IconButton label={t("common.open_folder")} className="h-10 w-10" onClick={() => openServerFolder(server)}>
          <FolderOpen size={17} />
        </IconButton>
      </Tooltip>
      <DropdownMenu
        trigger={
          <IconButton label={t("common.more")} className="h-10 w-10 data-[state=open]:bg-surface3 data-[state=open]:text-white">
            <MoreHorizontal size={17} />
          </IconButton>
        }
      >
        <ServerDropdownContent server={server} onDeleted={() => nav({ to: "/servers" })} />
      </DropdownMenu>
    </div>
  );
}

export function ServerPage() {
  const t = useT();
  const { id } = route.useParams();
  const { tab } = route.useSearch();
  const navTab = route.useNavigate();
  const nav = useNavigate();
  const { data: server, isError, error, refetch } = useServer(id);
  const setTab = (v: ServerTab) => navTab({ search: { tab: v }, replace: true });

  useEffect(() => {
    if (isError && (error as { kind?: string })?.kind === "not_found") nav({ to: "/servers", replace: true });
  }, [isError, error, nav]);

  if (!server) {
    return <div className="flex h-full flex-col">{isError ? <ErrorState error={error} onRetry={() => refetch()} className="flex-1" /> : <HeaderSkeleton />}</div>;
  }

  return (
    <div className="flex h-full flex-col" style={accentVars(serverAccent(server))}>
      <header className="shrink-0 border-b border-line bg-panel">
        <div className={cn(wrap, "flex items-center gap-4 pb-3 pt-5")}>
          <Tooltip content={t("srv.icon.choose")}>
            <button onClick={() => setServerIcon(server)} className="shrink-0" aria-label={t("srv.icon.choose")}>
              <ServerIcon server={server} size={64} />
            </button>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <h1 className="display truncate text-[22px]" title={server.name}>
              {server.name}
            </h1>
            <MetaLine server={server} />
          </div>
          <HeaderControls server={server} />
        </div>
        <div className={wrap}>
          <Tabs<ServerTab>
            value={tab}
            onChange={setTab}
            className="-mx-3 h-11! border-b-0"
            items={[
              { value: "console", label: t("srv.tab.console") },
              { value: "settings", label: t("srv.tab.settings") },
              { value: "players", label: t("srv.tab.players") },
              { value: "worlds", label: t("srv.tab.worlds") },
              { value: "files", label: t("srv.tab.files") },
              { value: "connection", label: t("srv.tab.connection") },
            ]}
          />
        </div>
      </header>
      <Banners server={server} />
      <div className="relative min-h-0 flex-1">
        {tab === "console" ? (
          <ConsoleTab server={server} />
        ) : tab === "settings" ? (
          <ServerSettingsTab server={server} />
        ) : tab === "players" ? (
          <PlayersTab server={server} />
        ) : tab === "worlds" ? (
          <ServerWorldsTab server={server} />
        ) : tab === "files" ? (
          <ServerFilesTab server={server} />
        ) : (
          <ConnectionTab server={server} />
        )}
      </div>
    </div>
  );
}
