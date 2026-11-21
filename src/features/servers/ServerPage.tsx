// Detailseite eines Servers: kompakter Kopf (Icon, Name, eine Meta-Zeile, Start/Stopp + ⋯) und darunter
// eine Zeile mit Tabs (Konsole, Einstellungen, Spieler, Welten & Backups, Dateien, Verbindung) und Hinweis-Symbolen.
import { useEffect, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Info, MoreHorizontal, SquareTerminal, Users, Wrench, X } from "lucide-react";
import { useServer, useServerStatus } from "@/lib/queries";
import type { Server } from "@/lib/types";
import type { ServerTab } from "@/app/router";
import { formatLoader, formatRelative } from "@/lib/format";
import { DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, ErrorState, IconButton, Skeleton, Tabs, Tooltip, cn } from "@/components/ui";
import { accentVars } from "@/components/instance/accent";
import { useT } from "@/i18n";
import { repairServer, setServerIcon, useServerTask } from "./actions";
import { AddressChip, ServerDropdownContent, ServerIcon, ServerPowerButton, StatusLabel, serverAccent, useAddress } from "./parts";
import { ConsoleTab } from "./ConsoleTab";
import { ServerSettingsTab } from "./ServerSettingsTab";
import { PlayersTab } from "./PlayersTab";
import { ServerWorldsTab } from "./ServerWorldsTab";
import { ConnectionTab } from "./ConnectionTab";
import { ServerFilesTab } from "@/features/files";
import { ServerAddonsTab } from "./ServerAddonsTab";
import { serverSoftware } from "./addonsApi";
import { PackToServerHost } from "@/features/serverpack/PackToServerDialog";

const route = getRouteApi("/servers/$id");
const wrap = "w-full px-6";

/** Tooltip-Inhalt eines Hinweis-Symbols: Titel + kurze Erklärung. */
function NoticeTip({ title, text }: { title: string; text?: string }) {
  return (
    <div className="max-w-[260px]">
      <div className="font-semibold text-text">{title}</div>
      {text && <div className="mt-0.5 text-muted">{text}</div>}
    </div>
  );
}

/** Hinweise (Absturz, frühere Sitzung, Installation fehlgeschlagen) und Spielerzahl als Symbole rechts in der Tab-Zeile. */
function Notices({ server, onTab }: { server: Server; onTab: (t: ServerTab) => void }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const task = useServerTask(server.id);
  const crashKey = st?.state === "crashed" ? `${st.started_at}:${st.exit_code}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const running = st?.state === "running";
  const crashText = st?.exit_code != null ? t("srv.crash.code", { code: st.exit_code }) : t("srv.crash.text");
  const players = st?.players.length ?? 0;

  return (
    <div className="flex items-center gap-1 pr-3">
      {crashKey && dismissed !== crashKey && (
        <DropdownMenu
          trigger={
            <IconButton
              label={t("srv.crash.title")}
              tip={<NoticeTip title={t("srv.crash.title")} text={crashText} />}
              variant="ghost"
              size="sm"
              className="text-danger!"
            >
              <AlertTriangle size={16} />
            </IconButton>
          }
        >
          <DropdownLabel>{t("srv.crash.title")}</DropdownLabel>
          <div className="max-w-[260px] px-2.5 pb-1.5 text-[12px] text-muted">{crashText}</div>
          <DropdownSeparator />
          <DropdownItem icon={<SquareTerminal size={14} />} onSelect={() => onTab("console")}>
            {t("srv.notice.to_console")}
          </DropdownItem>
          <DropdownItem icon={<X size={14} />} onSelect={() => setDismissed(crashKey)}>
            {t("srv.notice.hide")}
          </DropdownItem>
        </DropdownMenu>
      )}
      {server.install_state === "failed" && !task && (
        <DropdownMenu
          trigger={
            <IconButton
              label={t("srv.install_failed.title")}
              tip={<NoticeTip title={t("srv.install_failed.title")} text={t("srv.install_failed.text")} />}
              variant="ghost"
              size="sm"
              badge
              badgeTone="warn"
              className="text-warn!"
            >
              <Wrench size={15} />
            </IconButton>
          }
        >
          <DropdownLabel>{t("srv.install_failed.title")}</DropdownLabel>
          <div className="max-w-[260px] px-2.5 pb-1.5 text-[12px] text-muted">{t("srv.install_failed.text")}</div>
          <DropdownSeparator />
          <DropdownItem icon={<Wrench size={14} />} onSelect={() => repairServer(server)}>
            {t("srv.repair")}
          </DropdownItem>
        </DropdownMenu>
      )}
      {st?.detached && st.state !== "stopped" && (
        <Tooltip content={<NoticeTip title={t("srv.detached.title")} text={t("srv.detached.text")} />}>
          <span className="grid h-8 w-8 place-items-center text-accent" aria-label={t("srv.detached.title")}>
            <Info size={16} />
          </span>
        </Tooltip>
      )}
      {running && (
        <IconButton
          label={t("srv.players_n", { n: players, max: st?.max_players ?? "–" })}
          tip
          variant="ghost"
          size="sm"
          badge={players}
          badgeTone="muted"
          onClick={() => onTab("players")}
        >
          <Users size={15} />
        </IconButton>
      )}
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <header className="shrink-0 border-b border-line">
      <div className={cn(wrap, "flex items-center gap-3 pb-1 pt-4")}>
        <Skeleton className="h-10 w-10" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <Skeleton className="h-9 w-[120px]" />
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
  const address = useAddress(s);
  const running = st?.state === "running";
  const parts: React.ReactNode[] = [`${serverSoftware(s, formatLoader)} · Minecraft ${s.mc_version}`];
  if (!running) parts.push(s.last_started ? t("srv.meta.last", { when: formatRelative(s.last_started) }) : t("srv.meta.never"));
  return (
    <div className="flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-meta text-muted">
      <StatusLabel server={s} status={st} />
      {parts.map((p, n) => (
        <span key={n} className="flex min-w-0 items-center gap-2 truncate">
          <span className="text-dim">·</span>
          {p}
        </span>
      ))}
      <span className="text-dim">·</span>
      <AddressChip address={address} flat className="-my-1" />
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
      <PackToServerHost />
      <header className="shrink-0 border-b border-line bg-panel">
        <div className={cn(wrap, "flex items-center gap-3 pb-1 pt-4")}>
          <Tooltip content={t("srv.icon.choose")}>
            <button onClick={() => setServerIcon(server)} className="shrink-0 rounded-ctl" aria-label={t("srv.icon.choose")}>
              <ServerIcon server={server} size={40} />
            </button>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-title text-text" title={server.name}>
              {server.name}
            </h1>
            <MetaLine server={server} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ServerPowerButton server={server} className="min-w-[112px]" />
            <DropdownMenu
              trigger={
                <IconButton label={t("common.more")} tip variant="ghost" className="data-[state=open]:bg-white/[.07] data-[state=open]:text-text">
                  <MoreHorizontal size={17} />
                </IconButton>
              }
            >
              <ServerDropdownContent server={server} onDeleted={() => nav({ to: "/servers" })} />
            </DropdownMenu>
          </div>
        </div>
        <div className={wrap}>
          <Tabs<ServerTab>
            value={tab}
            onChange={setTab}
            className="-mx-3 h-11 border-b-0"
            items={[
              { value: "console", label: t("srv.tab.console") },
              { value: "settings", label: t("srv.tab.settings") },
              { value: "players", label: t("srv.tab.players") },
              ...(server.platform || server.loader.kind !== "vanilla"
                ? [{ value: "addons" as const, label: server.platform ? t("srv.tab.plugins") : t("srv.tab.mods") }]
                : []),
              { value: "worlds", label: t("srv.tab.worlds") },
              { value: "files", label: t("srv.tab.files") },
              { value: "connection", label: t("srv.tab.connection") },
            ]}
            right={<Notices server={server} onTab={setTab} />}
          />
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {tab === "console" ? (
          <ConsoleTab server={server} />
        ) : tab === "settings" ? (
          <ServerSettingsTab server={server} />
        ) : tab === "players" ? (
          <PlayersTab server={server} />
        ) : tab === "addons" ? (
          <ServerAddonsTab server={server} />
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
