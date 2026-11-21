// Plugins (Paper/Purpur/Folia: plugins/) bzw. Mods (Fabric & Co.: mods/) eines Servers: links die installierten
// Dateien (aktivieren/deaktivieren, entfernen, Updates), rechts der Weg zur Entdecken-Seite (Server als Ziel) und Modpacks.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, FolderOpen, RefreshCw } from "lucide-react";
import { useServerStatus } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { Button, ErrorState, IconButton, SettingsCard, Skeleton, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { openServerFolder } from "./actions";
import { addonApi, aqk } from "./addonsApi";
import { PackCard } from "@/features/serverpack/PackCard";
import { folderOf, updateAddons } from "./addons/addonActions";
import { FindCard } from "./addons/FindCard";
import { InstalledList } from "./addons/InstalledList";

export function ServerAddonsTab({ server }: { server: Server }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const running = st?.state === "running" || st?.state === "starting";
  const list = useQuery({
    queryKey: aqk.addons(server.id),
    queryFn: () => addonApi.list(server.id),
    staleTime: 15_000,
  });
  const updates = useQuery({
    queryKey: aqk.updates(server.id),
    queryFn: () => addonApi.updates(server.id),
    staleTime: 10 * 60_000,
    enabled: !!list.data?.items.length,
  });
  const [updating, setUpdating] = useState(false);
  const plugins = !!server.platform;
  const ups = updates.data ?? [];

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-6">
        <p className="min-w-0 flex-1 truncate text-meta text-dim">
          {running
            ? t("srv.addons.hint_running")
            : plugins
              ? t("srv.addons.hint.plugins", {
                  loaders: list.data?.target.loaders.join(", ") ?? "…",
                })
              : t("srv.addons.hint.mods")}
        </p>
        <IconButton label={t("srv.addons.check_updates")} tip variant="ghost" onClick={() => updates.refetch()} disabled={updates.isFetching}>
          <RefreshCw size={15} className={cn(updates.isFetching && "animate-spin")} />
        </IconButton>
        <IconButton label={t("common.open_folder")} tip variant="ghost" onClick={() => openServerFolder(server, folderOf(server))}>
          <FolderOpen size={16} />
        </IconButton>
        {ups.length > 0 && (
          <Button
            size="sm"
            variant="accent"
            icon={<ArrowUpCircle size={14} />}
            loading={updating}
            onClick={async () => {
              setUpdating(true);
              await updateAddons(server, null);
              setUpdating(false);
            }}
          >
            {t("srv.addons.update_all", { n: ups.length })}
          </Button>
        )}
      </div>
      <div className="scroll min-h-0 flex-1">
        {list.isError && !list.data ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} className="py-10" />
        ) : !list.data ? (
          <div className="grid grid-cols-2 gap-5 px-6 pt-1">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-5 px-6 pb-8 pt-1">
            <SettingsCard
              title={
                <>
                  {plugins ? t("srv.addons.installed_plugins") : t("srv.addons.installed_mods")}
                  <span className="ml-1.5 text-[12px] font-medium text-dim">{list.data.items.length}</span>
                </>
              }
              right={
                <Tooltip
                  content={t("srv.addons.folder", {
                    folder: list.data.target.folder,
                  })}
                >
                  <span className="font-mono text-caption text-dim">{list.data.target.folder}/</span>
                </Tooltip>
              }
            >
              <InstalledList server={server} list={list.data} updates={ups} />
            </SettingsCard>
            <div className="flex flex-col gap-5">
              <FindCard server={server} plugins={plugins} />
              {!plugins && <PackCard server={server} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
