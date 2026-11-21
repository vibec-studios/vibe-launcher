// Serverliste: eine Werkzeugleiste (Suche, „Neuer Server“) über flachen Zeilen mit Status, Adresse und Start/Stopp;
// alles Weitere im ⋯-Menü bzw. per Rechtsklick. Der Seitentitel steht in der Titelleiste.
import { memo, useDeferredValue, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, PackageOpen, Plus, SearchX, Server as ServerIconLucide, Users } from "lucide-react";
import { openPackToServer } from "@/features/serverpack/store";
import { PackToServerHost } from "@/features/serverpack/PackToServerDialog";
import { useServerStatus, useServers } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { formatLoader } from "@/lib/format";
import { Button, ContextMenu, DropdownMenu, EmptyState, ErrorState, IconButton, Page, PageToolbar, Progress, SearchInput, Skeleton, cn } from "@/components/ui";
import { accentVars } from "@/components/instance/accent";
import { useT } from "@/i18n";
import { openNewServer, serverAddress, useServerTask } from "./actions";
import { serverSoftware } from "./addonsApi";
import { AddressChip, ServerContextMenuContent, ServerDropdownContent, ServerIcon, ServerPowerButton, StatusLabel, serverAccent } from "./parts";

const cols = "grid grid-cols-[minmax(0,1fr)_130px_minmax(140px,220px)_auto] items-center gap-4";

const ServerRow = memo(function ServerRow({ server: s }: { server: Server }) {
  const t = useT();
  const nav = useNavigate();
  const st = useServerStatus(s.id);
  const task = useServerTask(s.id);
  const running = st?.state === "running";
  const address = serverAddress(s, st);
  const open = () => nav({ to: "/servers/$id", params: { id: s.id }, search: { tab: "console" } });
  const meta = [serverSoftware(s, formatLoader), `Minecraft ${s.mc_version}`];
  if (running) meta.push(t("srv.players_n", { n: st?.players.length ?? 0, max: st?.max_players ?? "–" }));
  return (
    <ContextMenu content={<ServerContextMenuContent server={s} />}>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          if (!e.repeat) open();
        }}
        style={accentVars(serverAccent(s))}
        className={cn(
          cols,
          "group relative cursor-pointer rounded-card px-3 py-2 outline-none transition-colors duration-100",
          "hover:bg-white/[.03] focus-visible:bg-white/[.04] data-[state=open]:bg-white/[.04]",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <ServerIcon server={s} size={36} />
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold text-text">{s.name}</div>
            <div className="truncate text-meta text-muted">{meta.join(" · ")}</div>
          </div>
        </div>
        <StatusLabel server={s} status={st} />
        <AddressChip address={address} flat />
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <ServerPowerButton server={s} size="sm" quiet className="w-[104px]" />
          <DropdownMenu
            trigger={
              <IconButton label={t("common.more")} tip variant="ghost" size="sm" className="data-[state=open]:bg-white/[.07] data-[state=open]:text-text">
                <MoreHorizontal size={16} />
              </IconButton>
            }
          >
            <ServerDropdownContent server={s} />
          </DropdownMenu>
        </div>
        {task && (
          <div className="absolute inset-x-3 bottom-0">
            <Progress value={task.progress} className="h-0.5" />
          </div>
        )}
      </div>
    </ContextMenu>
  );
});

function RowSkeleton() {
  return (
    <div className={cn(cols, "px-3 py-2")}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-8 w-[136px]" />
    </div>
  );
}

export function ServersPage() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useServers();
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const list = data ?? [];
  const sorted = [...list]
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.mc_version.includes(q) || s.loader.kind.includes(q) || (s.platform?.kind.includes(q) ?? false))
    .sort((a, b) => (b.last_started ?? b.created_at) - (a.last_started ?? a.created_at));

  return (
    <Page>
        <PackToServerHost />
        {list.length > 0 && (
          <PageToolbar
            actions={
              <>
                <Button variant="subtle" icon={<PackageOpen size={15} />} onClick={() => openPackToServer()} data-testid="servers-pack">
                  {t("sp.menu.from_pack")}
                </Button>
                <Button variant="primary" data-tour="servers-new" icon={<Plus size={16} />} onClick={() => openNewServer()}>
                  {t("srv.new")}
                </Button>
              </>
            }
          >
            <SearchInput value={query} onChange={setQuery} placeholder={t("srv.search")} className="min-w-[160px] max-w-[320px] flex-1 basis-[240px]" />
          </PageToolbar>
        )}

        {isError && !data ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading && !data ? (
          <div className="flex flex-col">
            {Array.from({ length: 3 }, (_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            className="rounded-panel bg-surface py-14"
            icon={<ServerIconLucide size={40} strokeWidth={1.4} />}
            title={t("srv.empty.title")}
            text={t("srv.empty.text")}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="primary" data-tour="servers-new" icon={<Plus size={16} />} onClick={() => openNewServer()}>
                  {t("srv.new")}
                </Button>
                <Button variant="subtle" icon={<PackageOpen size={15} />} onClick={() => openPackToServer()}>
                  {t("sp.menu.from_pack")}
                </Button>
              </div>
            }
          />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<SearchX size={30} strokeWidth={1.6} />}
            title={t("srv.no_match", { q: query })}
            action={
              <Button size="sm" onClick={() => setQuery("")}>
                {t("layout.search.reset")}
              </Button>
            }
          />
        ) : (
          <>
            <div data-tour="servers-list" className="-mx-3 flex flex-col">
              {sorted.map((s) => (
                <ServerRow key={s.id} server={s} />
              ))}
            </div>
            {/* Wenige Server: kurzer Hinweis, wie Freunde mitspielen – statt einer großen leeren Fläche */}
            {list.length <= 3 && !q && (
              <p className="mt-3 flex items-start gap-2.5 rounded-card bg-surface px-4 py-3 text-[12.5px] leading-relaxed text-muted">
                <Users size={15} className="mt-px shrink-0 text-dim" />
                {t("srv.list.hint")}
              </p>
            )}
          </>
        )}
    </Page>
  );
}
