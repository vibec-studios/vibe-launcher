// Welten einer Bedrock-Instanz: Name, Icon, Größe, zuletzt gespielt, aktive Packs. Sichern, als .mcworld
// exportieren, importieren, löschen (vorher automatische Sicherung, dann Papierkorb).
import { memo, useDeferredValue, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FileArchive, FolderOpen, MoreHorizontal, Trash2, Upload } from "lucide-react";
import type { Instance } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { Button, DropdownItem, DropdownMenu, DropdownSeparator, EmptyState, ErrorState, IconButton, SearchInput, Skeleton, confirm, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { bedrockApi, bqk, type BedrockWorld } from "./api";
import { DataIcon } from "./parts";
import { pickBedrockFiles } from "./AddonsTab";

async function exportWorld(instance: Instance, w: BedrockWorld) {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const dest = await save({ title: tt("bedrock.worlds.export_title"), defaultPath: `${w.name}.mcworld`, filters: [{ name: "Minecraft-Welt", extensions: ["mcworld"] }] });
    if (!dest) return;
    await bedrockApi.worldExport(instance.id, w.folder, dest);
    toast.success(tt("bedrock.export.done"), dest);
  } catch (e) {
    toast.error(e, tt("bedrock.export.failed"));
  }
}

export async function backupBedrockWorld(instance: Instance, w: { folder: string; name: string }, after?: () => void) {
  try {
    await bedrockApi.backupCreate(instance.id, w.folder);
    toast.success(tt("bedrock.worlds.backed_up"), w.name);
    after?.();
  } catch (e) {
    toast.error(e, tt("bedrock.worlds.backup_failed"));
  }
}

const WorldRow = memo(function WorldRow({ instance, world, multiUser }: { instance: Instance; world: BedrockWorld; multiUser: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const packs = world.resource_packs.length + world.behavior_packs.length;
  const meta = [
    world.last_played ? formatRelative(world.last_played) : null,
    formatBytes(world.size),
    packs ? t(packs === 1 ? "bedrock.worlds.packs_1" : "bedrock.worlds.packs_n", { n: packs }) : null,
    multiUser && world.user ? t("bedrock.worlds.user", { id: world.user.slice(-4) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const del = async () => {
    const ok = await confirm({ title: t("worlds.delete.title", { name: world.name }), text: t("bedrock.worlds.delete_text"), confirmLabel: t("common.delete"), danger: true });
    if (!ok) return;
    try {
      await bedrockApi.worldDelete(instance.id, world.folder);
      toast.success(t("worlds.deleted"), world.name);
      qc.invalidateQueries({ queryKey: bqk.worlds(instance.id) });
      qc.invalidateQueries({ queryKey: bqk.backups(instance.id) });
    } catch (e) {
      toast.error(e, t("worlds.delete_failed"));
    }
  };
  return (
    <div className="group flex h-14 items-center gap-3 px-6 transition-colors duration-100 hover:bg-white/[.03]">
      <DataIcon src={world.icon} size={52} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-text">{world.name}</div>
        <div className="truncate text-[12px] leading-tight text-dim">{meta}</div>
      </div>
      <Button
        size="sm"
        variant="subtle"
        icon={<Archive size={13} />}
        className="opacity-70 group-hover:opacity-100"
        onClick={() => void backupBedrockWorld(instance, world, () => qc.invalidateQueries({ queryKey: bqk.backups(instance.id) }))}
      >
        {t("bedrock.worlds.backup")}
      </Button>
      <DropdownMenu
        trigger={
          <IconButton label={t("common.more")} size="sm" variant="ghost" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal size={15} />
          </IconButton>
        }
      >
        <DropdownItem icon={<Upload size={14} />} onSelect={() => void exportWorld(instance, world)}>
          {t("bedrock.worlds.export")}
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => void del()}>
          {t("common.delete")}
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
});

export function BedrockWorldsTab({ instance }: { instance: Instance }) {
  const t = useT();
  const q = useQuery({ queryKey: bqk.worlds(instance.id), queryFn: () => bedrockApi.worlds(instance.id) });
  const canImport = useQuery({ queryKey: bqk.canImportWorlds(instance.id), queryFn: () => bedrockApi.canImportWorlds(instance.id) });
  const [query, setQuery] = useState("");
  const dq = useDeferredValue(query.trim().toLowerCase());
  const list = useMemo(() => (q.data ?? []).filter((w) => !dq || w.name.toLowerCase().includes(dq)), [q.data, dq]);
  const multiUser = new Set((q.data ?? []).map((w) => w.user)).size > 1;
  const noPlayer = canImport.data === false;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 px-6 pt-2">
        <SearchInput value={query} onChange={setQuery} placeholder={t("worlds.search")} className="w-[240px] min-w-[140px] shrink [&_input]:h-8" />
        <div className="flex-1" />
        <IconButton label={t("bedrock.worlds.open_folder")} tip variant="ghost" onClick={() => bedrockApi.openFolder(instance.id, "worlds").catch((e) => toast.error(e))}>
          <FolderOpen size={16} />
        </IconButton>
        <Button size="sm" variant="ghost" icon={<FileArchive size={14} />} disabled={noPlayer} title={noPlayer ? t("bedrock.worlds.need_start") : undefined} onClick={() => void pickBedrockFiles(instance)}>
          {t("bedrock.worlds.import")}
        </Button>
      </div>
      <div className="scroll min-h-0 flex-1 pb-6">
        {q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="flex flex-col">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex h-14 items-center gap-3 px-6">
                <Skeleton className="h-9 w-[52px]" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : q.data.length === 0 ? (
          <EmptyState icon="globe" title={t("worlds.empty.title")} text={noPlayer ? t("bedrock.worlds.empty_new") : t("bedrock.worlds.empty")} />
        ) : list.length === 0 ? (
          <EmptyState icon="search_none" title={t("instances.no_match")} text={t("worlds.no_match", { q: query.trim() })} />
        ) : (
          <div className="flex flex-col">
            {list.map((w) => (
              <WorldRow key={`${w.user}/${w.folder}`} instance={instance} world={w} multiUser={multiUser} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
