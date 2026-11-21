// Server-Liste einer Instanz (servers.dat): Ping mit MOTD/Spielern/Latenz, Beitreten per Quick Play,
// Hinzufügen/Bearbeiten/Entfernen/Sortieren.
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance, ServerEntry } from "@/lib/types";
import { Button, EmptyState, ErrorState, IconButton, Skeleton, Tooltip, confirm, toast } from "@/components/ui";
import { useRunPhase } from "@/components/instance/status";
import { useT } from "@/i18n";
import { PageTools } from "./toolbar";
import { sourcesForServer, worldMapApi, type MapSource } from "./map/api";
import { XaeroInstallHint } from "./map/MapControls";
import { ServerMapDialog } from "./map/ServerMapDialog";
import { EditDialog } from "./servers/EditDialog";
import { LegacyAddressNotice } from "./servers/LegacyAddressNotice";
import { ServerRow } from "./servers/ServerRow";
import { key } from "./servers/keys";

export function ServersTab({ instance }: { instance: Instance }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key(instance.id), queryFn: () => api.instanceServersList(instance.id) });
  const { phase } = useRunPhase(instance.id);
  const locked = phase !== "idle";
  const [editing, setEditing] = useState<number | null>(null);
  const [mapEntry, setMapEntry] = useState<{ entry: ServerEntry; sources: MapSource[] } | null>(null);
  const mapSources = useQuery({ queryKey: ["world-map-sources", instance.id], queryFn: () => worldMapApi.sources(instance.id), retry: false, staleTime: 30_000 });
  const list = q.data ?? [];
  const showMap = useCallback(
    (entry: ServerEntry) => setMapEntry({ entry, sources: sourcesForServer(mapSources.data, entry.ip) }),
    [mapSources.data],
  );
  const anyServerMap = (mapSources.data ?? []).some((source) => source.multiplayer && source.kind === "xaero");

  const save = async (next: ServerEntry[]) => {
    const prev = q.data;
    qc.setQueryData(key(instance.id), next);
    try {
      await api.instanceServersSave(instance.id, next);
    } catch (e) {
      qc.setQueryData(key(instance.id), prev);
      toast.error(e, t("servers.save_failed"));
    }
  };
  const onMove = (i: number, d: -1 | 1) => {
    const next = list.slice();
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    save(next);
  };
  const onRemove = async (i: number) => {
    if (!(await confirm({ title: t("servers.remove_title", { name: list[i].name }), confirmLabel: t("common.remove"), danger: true }))) return;
    save(list.filter((_, j) => j !== i));
  };
  const blank: ServerEntry = { name: "", ip: "", icon: null, accept_textures: null, hidden: false };

  return (
    <div className="scroll h-full">
      <PageTools>
        {locked && (
          <Tooltip content={t("servers.locked")}>
            <span className="grid h-9 w-9 place-items-center text-warn" aria-label={t("servers.locked")}>
              <Lock size={14} />
            </span>
          </Tooltip>
        )}
        <div className="flex-1" />
        <IconButton label={t("servers.refresh")} tip variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ["server-ping"] })}>
          <RefreshCw size={16} />
        </IconButton>
        {/* Leer: „Server hinzufügen“ steht groß im Leerzustand */}
        {list.length > 0 && (
          <Button variant="accent" icon={<Plus size={16} />} disabled={locked} onClick={() => setEditing(-1)}>
            {t("servers.add")}
          </Button>
        )}
      </PageTools>
      <div className="pb-6">
        {q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="flex flex-col gap-1 px-6">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon="server"
            title={t("servers.empty.title")}
            text={t("servers.empty.text")}
            action={
              <Button size="sm" variant="accent" icon={<Plus size={14} />} disabled={locked} onClick={() => setEditing(-1)}>
                {t("servers.add")}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col">
            <LegacyAddressNotice instance={instance} list={list} locked={locked} />
            {list.map((s, i) => (
              <ServerRow
                key={`${s.ip}-${i}`}
                instance={instance}
                entry={s}
                index={i}
                count={list.length}
                locked={locked}
                hasMap={sourcesForServer(mapSources.data, s.ip).length > 0}
                onShowMap={showMap}
                onEdit={setEditing}
                onMove={onMove}
                onRemove={onRemove}
              />
            ))}
            {mapSources.isSuccess && !anyServerMap && (
              <div className="mx-6 mt-3">
                <XaeroInstallHint instanceId={instance.id} server />
              </div>
            )}
          </div>
        )}
      </div>
      {mapEntry && <ServerMapDialog instanceId={instance.id} name={mapEntry.entry.name} sources={mapEntry.sources} onClose={() => setMapEntry(null)} />}
      {editing !== null && (
        <EditDialog
          entry={editing >= 0 ? list[editing] : blank}
          onClose={() => setEditing(null)}
          onSave={(e) => {
            save(editing >= 0 ? list.map((x, j) => (j === editing ? e : x)) : [...list, e]);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
