// Serverliste: kompakte Zeilen mit Status, Spielern, Adresse und Start/Stopp; Rechtsklick-Menü.
import { memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, Plus, Server as ServerIconLucide, Users } from "lucide-react";
import { useServerStatus, useServers } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { formatLoader } from "@/lib/format";
import { Button, ContextMenu, DropdownMenu, EmptyState, ErrorState, IconButton, Progress, Skeleton, cn } from "@/components/ui";
import { accentVars } from "@/components/instance/accent";
import { useT } from "@/i18n";
import { openNewServer, serverAddress, useServerTask } from "./actions";
import { AddressChip, ServerContextMenuContent, ServerDropdownContent, ServerIcon, ServerPowerButton, StatusLabel, serverAccent } from "./parts";

const cols = "grid grid-cols-[minmax(0,1fr)_120px_70px_minmax(150px,230px)_auto] items-center gap-4";

const ServerRow = memo(function ServerRow({ server: s }: { server: Server }) {
  const t = useT();
  const nav = useNavigate();
  const st = useServerStatus(s.id);
  const task = useServerTask(s.id);
  const running = st?.state === "running";
  const address = serverAddress(s, st);
  const open = () => nav({ to: "/servers/$id", params: { id: s.id }, search: { tab: "console" } });
  return (
    <ContextMenu content={<ServerContextMenuContent server={s} />}>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open()}
        style={accentVars(serverAccent(s))}
        className={cn(
          cols,
          "group relative cursor-pointer border border-line bg-surface px-3 py-2.5 outline-none transition-colors duration-100",
          "hover:border-line2 hover:bg-surface2 focus-visible:border-accent",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <ServerIcon server={s} size={40} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-white">{s.name}</div>
            <div className="truncate text-[12px] text-muted">
              {formatLoader(s.loader)} · Minecraft {s.mc_version}
            </div>
          </div>
        </div>
        <StatusLabel server={s} status={st} />
        <span className={cn("flex items-center gap-1.5 text-[12px] tabular-nums", running ? "text-text" : "text-dim")}>
          <Users size={13} className="text-dim" />
          {running ? `${st?.players.length ?? 0}/${st?.max_players ?? "–"}` : "–"}
        </span>
        <AddressChip address={address} />
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <ServerPowerButton server={s} size="sm" className="w-[104px]" />
          <DropdownMenu
            trigger={
              <IconButton label={t("common.more")} size="sm" className="data-[state=open]:bg-surface3 data-[state=open]:text-white">
                <MoreHorizontal size={15} />
              </IconButton>
            }
          >
            <ServerDropdownContent server={s} />
          </DropdownMenu>
        </div>
        {task && (
          <div className="absolute inset-x-0 bottom-0">
            <Progress value={task.progress} className="h-0.5" />
          </div>
        )}
      </div>
    </ContextMenu>
  );
});

function RowSkeleton() {
  return (
    <div className={cn(cols, "border border-line bg-surface px-3 py-2.5")}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 w-10" />
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-8 w-[138px]" />
    </div>
  );
}

export function ServersPage() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useServers();
  const list = data ?? [];
  const sorted = [...list].sort((a, b) => (b.last_started ?? b.created_at) - (a.last_started ?? a.created_at));

  return (
    <div className="scroll h-full">
      <div className="flex flex-col gap-4 px-6 pb-10 pt-5">
        <header className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="display truncate text-[22px]">{t("nav.servers")}</h1>
            <p className="mt-0.5 text-[13px] text-muted">{t("srv.list.desc")}</p>
          </div>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => openNewServer()}>
            {t("srv.new")}
          </Button>
        </header>

        {isError && !data ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading && !data ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            className="mt-6 border border-dashed border-line2 bg-surface py-14"
            icon={<ServerIconLucide size={44} strokeWidth={1.4} />}
            title={t("srv.empty.title")}
            text={t("srv.empty.text")}
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => openNewServer()}>
                {t("srv.new")}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((s) => (
              <ServerRow key={s.id} server={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
