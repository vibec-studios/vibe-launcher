// Kleine Bausteine für Server: Status-Punkt, Icon, Adresse mit Kopieren, Start/Stopp-Knopf, Aktionsmenü.
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Compass, Copy, FolderOpen, FolderTree, Gamepad2, ImageIcon, PackageOpen, Play, RotateCcw, RotateCw, Skull, Square, SquareTerminal, Trash2, Wrench } from "lucide-react";
import { serverTargetKey } from "@/features/installtarget/registry";
import { openPackToServer } from "@/features/serverpack/store";
import {
  Button,
  ContextItem,
  ContextSeparator,
  ContextSub,
  DropdownItem,
  DropdownSeparator,
  DropdownSub,
  Spinner,
  Tooltip,
  cn,
  type ButtonSize,
  type MenuItemProps,
} from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { instanceAccent } from "@/lib/format";
import { useServerStatus } from "@/lib/queries";
import type { Server, ServerRunState, ServerStatus } from "@/lib/types";
import { useT } from "@/i18n";
import {
  copyAddress,
  joinServer,
  killServer,
  openServerFolder,
  removeServer,
  repairServer,
  resetServerIcon,
  restartServer,
  serverAddress,
  setServerIcon,
  startServer,
  stopServer,
  useServerTask,
} from "./actions";

export const serverAccent = (s: Server) => instanceAccent(s.id, s.accent);

export const stateColor: Record<ServerRunState, string> = {
  stopped: "bg-dim",
  starting: "bg-warn",
  running: "bg-ok",
  stopping: "bg-warn",
  crashed: "bg-danger",
};

export const stateText: Record<ServerRunState, string> = {
  stopped: "text-muted",
  starting: "text-warn",
  running: "text-ok",
  stopping: "text-warn",
  crashed: "text-danger",
};

export function StatusDot({ state, className }: { state: ServerRunState; className?: string }) {
  const pulse = state === "starting" || state === "stopping";
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-dot", stateColor[state], pulse && "animate-pulse", className)} aria-hidden />;
}

/** „● Läuft“ – mit Installationsfortschritt, falls eine Aufgabe läuft. */
export function StatusLabel({ server, status }: { server: Server; status: ServerStatus | undefined }) {
  const t = useT();
  const task = useServerTask(server.id);
  if (task)
    return (
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-warn">
        <Spinner size={10} />
        {task.progress !== null ? `${t("srv.state.installing")} ${Math.round(task.progress * 100)} %` : t("srv.state.installing")}
      </span>
    );
  const state = status?.state ?? "stopped";
  return (
    <span className={cn("flex items-center gap-1.5 text-[12px] font-medium", stateText[state])}>
      <StatusDot state={state} />
      {t(`srv.state.${state}`)}
    </span>
  );
}

export function ServerIcon({ server, size = 40 }: { server: Server; size?: number }) {
  return <InstanceIcon icon={server.icon} accent={serverAccent(server)} size={size} />;
}

/** Adresse in Mono mit Kopieren-Knopf. `flat` = ohne Feld (Listenzeilen, Kopfzeile). */
export function AddressChip({ address, className, large, flat }: { address: string; className?: string; large?: boolean; flat?: boolean }) {
  const t = useT();
  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        flat ? "h-7 gap-0.5" : "rounded-ctl bg-field",
        !flat && (large ? "h-12 rounded-card" : "h-7"),
        className,
      )}
    >
      <span
        className={cn(
          "selectable min-w-0 truncate font-mono",
          flat ? "text-[12px] text-muted" : "flex-1 px-2 text-text",
          large ? "px-4 text-[18px]" : "text-[12px]",
        )}
      >
        {address}
      </span>
      <Tooltip content={t("common.copy")}>
        <button
          aria-label={t("common.copy")}
          onClick={(e) => {
            e.stopPropagation();
            copyAddress(address);
          }}
          className={cn(
            "grid shrink-0 place-items-center rounded-ctl text-dim transition-colors duration-100 hover:bg-white/[.07] hover:text-text",
            large ? "mr-1.5 h-9 w-9" : "h-7 w-7",
          )}
        >
          <Copy size={large ? 16 : 12} />
        </button>
      </Tooltip>
    </div>
  );
}

export function useAddress(server: Server) {
  const st = useServerStatus(server.id);
  return serverAddress(server, st);
}

/** Hauptknopf: Starten / Stoppen / Startet … / Installiert …
 *  `quiet` = ohne Farbfläche (Listenzeilen – dort gibt es mehrere davon, nur eine Hauptaktion je Ansicht). */
export function ServerPowerButton({ server, size = "md", className, quiet }: { server: Server; size?: ButtonSize; className?: string; quiet?: boolean }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const task = useServerTask(server.id);
  const state = st?.state ?? "stopped";
  if (task)
    return (
      <Button size={size} variant="ghost" disabled className={className} icon={<Spinner size={12} />}>
        {task.progress !== null ? `${Math.round(task.progress * 100)} %` : t("srv.state.installing")}
      </Button>
    );
  if (state === "running")
    return (
      <Button
        size={size}
        variant="danger"
        className={className}
        icon={<Square size={12} fill="currentColor" />}
        onClick={(e) => {
          e.stopPropagation();
          stopServer(server);
        }}
      >
        {t("common.stop")}
      </Button>
    );
  if (state === "starting" || state === "stopping")
    return (
      <Button size={size} variant="ghost" className={className} loading disabled>
        {t(`srv.state.${state}`)}
      </Button>
    );
  return (
    <Button
      size={size}
      variant={quiet ? "ghost" : "accent"}
      className={className}
      icon={<Play size={13} fill="currentColor" className={quiet ? "text-accent" : undefined} />}
      onClick={(e) => {
        e.stopPropagation();
        startServer(server);
      }}
    >
      {t("srv.start")}
    </Button>
  );
}

// ------------------------------------------------------------------ Aktionsmenü (Rechtsklick + „Mehr“)

interface Kit {
  Item: (p: MenuItemProps) => ReactNode;
  Sub: (p: { icon?: ReactNode; label: ReactNode; children: ReactNode }) => ReactNode;
  Sep: () => ReactNode;
}
const contextKit: Kit = { Item: ContextItem, Sub: ContextSub, Sep: ContextSeparator };
const dropdownKit: Kit = { Item: DropdownItem, Sub: DropdownSub, Sep: DropdownSeparator };

export const SERVER_FOLDERS = ["", "mods", "config", "world", "logs", "backups"] as const;

function MenuBody({ server: s, kit, onPage, onDeleted }: { server: Server; kit: Kit; onPage?: boolean; onDeleted?: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const { Item, Sub, Sep } = kit;
  const st = useServerStatus(s.id);
  const task = useServerTask(s.id);
  const state = st?.state ?? "stopped";
  const active = state === "running" || state === "starting" || state === "stopping";
  const address = serverAddress(s, st);

  return (
    <>
      {active ? (
        <>
          <Item icon={<Square size={13} />} disabled={state !== "running"} onSelect={() => stopServer(s)}>
            {t("common.stop")}
          </Item>
          <Item icon={<RotateCw size={14} />} disabled={state !== "running" || st?.detached} onSelect={() => restartServer(s)}>
            {t("srv.restart")}
          </Item>
          <Item icon={<Skull size={14} />} danger onSelect={() => killServer(s)}>
            {t("srv.kill")}
          </Item>
        </>
      ) : (
        <Item icon={<Play size={14} />} disabled={!!task} onSelect={() => startServer(s)}>
          {t("srv.start")}
        </Item>
      )}
      {active && (
        <Item icon={<Gamepad2 size={14} />} disabled={state !== "running"} onSelect={() => joinServer(s)}>
          {t("srv.join")}
        </Item>
      )}
      {!onPage && (
        <Item icon={<SquareTerminal size={14} />} onSelect={() => nav({ to: "/servers/$id", params: { id: s.id }, search: { tab: "console" } })}>
          {t("srv.console")}
        </Item>
      )}
      <Item icon={<Copy size={14} />} onSelect={() => copyAddress(address)}>
        {t("srv.copy_address")}
      </Item>
      <Sub icon={<FolderOpen size={14} />} label={t("common.open_folder")}>
        {SERVER_FOLDERS.map((f) => (
          <Item key={f || "root"} icon={f ? <FolderTree size={14} /> : <FolderOpen size={14} />} onSelect={() => openServerFolder(s, f || null)}>
            {f ? <span className="font-mono text-[12px]">{f}</span> : t("srv.folder.root")}
          </Item>
        ))}
      </Sub>
      <Sep />
      <Sub icon={<ImageIcon size={14} />} label={t("srv.icon")}>
        <Item icon={<ImageIcon size={14} />} onSelect={() => setServerIcon(s)}>
          {t("srv.icon.choose")}
        </Item>
        <Item icon={<RotateCcw size={14} />} disabled={!s.icon} onSelect={() => resetServerIcon(s)}>
          {t("srv.icon.reset")}
        </Item>
      </Sub>
      <Item icon={<Compass size={14} />} disabled={!s.platform && s.loader.kind === "vanilla"} onSelect={() => nav({ to: "/discover", search: { server: serverTargetKey({ origin: "local", id: s.id }) } })}>
        {s.platform ? t("st.menu.find_plugins") : t("st.menu.find_mods")}
      </Item>
      <Item icon={<PackageOpen size={14} />} disabled={active} onSelect={() => openPackToServer({ serverKey: serverTargetKey({ origin: "local", id: s.id }) })}>
        {t("sp.menu.apply")}
      </Item>
      <Item icon={<Wrench size={14} />} disabled={active || !!task} onSelect={() => repairServer(s)}>
        {t("srv.repair")}
      </Item>
      <Sep />
      <Item icon={<Trash2 size={14} />} danger disabled={active} onSelect={() => removeServer(s, onDeleted)}>
        {t("common.delete")}
      </Item>
    </>
  );
}

export function ServerContextMenuContent({ server }: { server: Server }) {
  return <MenuBody server={server} kit={contextKit} />;
}

export function ServerDropdownContent({ server, onDeleted }: { server: Server; onDeleted?: () => void }) {
  return <MenuBody server={server} kit={dropdownKit} onPage onDeleted={onDeleted} />;
}
