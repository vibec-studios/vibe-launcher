// Welten einer Instanz (saves/) als ruhige Liste. Beim Hover: direkt in die Welt starten; ⋯ bzw. Rechtsklick: Ordner
// öffnen, Backup erstellen, in andere Instanz kopieren, Löschen. Werkzeuge in der gemeinsamen Zeile (PageTools).
import { VoiceWorldHint } from "./VoiceWorldHint";
import { memo, useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Copy, FileArchive, FolderOpen, Map, MoreHorizontal, Package, Play, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { Instance, World } from "@/lib/types";
import { formatBytes, formatRelative, imageSrc } from "@/lib/format";
import {
  Button,
  ContextItem,
  ContextLabel,
  ContextMenu,
  ContextSeparator,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  IconButton,
  SearchInput,
  Skeleton,
  Tag,
  confirm,
  toast,
  type MenuItemProps,
} from "@/components/ui";
import { PixelBlock } from "@/components/instance/InstanceIcon";
import { useT } from "@/i18n";
import { CopyWorldDialog, backupWorld, importWorldZip } from "@/features/backups/worldActions";
import { supportsQuickPlay, useInstanceActions } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { PageTools } from "./toolbar";
import { WorldDatapacksDialog } from "./WorldDatapacksDialog";
import { WorldPreviewDialog, worldModeLabel } from "./WorldPreviewDialog";

function WorldIcon({ world }: { world: World }) {
  const [failed, setFailed] = useState(false);
  const src = imageSrc(world.icon);
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface2">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover [image-rendering:pixelated]"
        />
      ) : (
        <PixelBlock color="#5fbf4a" size={24} />
      )}
    </div>
  );
}

/** Aktionen einer Welt – dieselben Einträge im ⋯-Menü und im Rechtsklick-Menü. */
function WorldMenu({ instance, world, onCopy, onPacks, onPreview, Item, Sep }: { instance: Instance; world: World; onCopy: (w: World) => void; onPacks: (w: World) => void; onPreview: (w: World) => void; Item: (p: MenuItemProps) => React.ReactNode; Sep: () => React.ReactNode }) {
  const t = useT();
  const openDir = () => api.instanceOpenFolder(instance.id, `saves/${world.folder}`).catch((e) => toast.error(e));
  const del = async () => {
    const ok = await confirm({
      title: t("worlds.delete.title", { name: world.name }),
      text: t("worlds.delete.text"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.worldDelete(instance.id, world.folder);
      toast.success(t("worlds.deleted"), world.name);
    } catch (e) {
      toast.error(e, t("worlds.delete_failed"));
    }
  };
  return (
    <>
      <Item icon={<Map size={14} />} onSelect={() => onPreview(world)}>
        {t("world_map.title")}
      </Item>
      <Item icon={<FolderOpen size={14} />} onSelect={openDir}>
        {t("common.open_folder")}
      </Item>
      <Item icon={<Package size={14} />} onSelect={() => onPacks(world)}>
        {t("dp.world.manage")}
      </Item>
      <Item icon={<Archive size={14} />} onSelect={() => backupWorld(instance, world)}>
        {t("worlds.backup")}
      </Item>
      <Item icon={<Copy size={14} />} onSelect={() => onCopy(world)}>
        {t("worlds.copy")}
      </Item>
      <Sep />
      <Item icon={<Trash2 size={14} />} danger onSelect={() => void del()}>
        {t("common.delete")}
      </Item>
    </>
  );
}

const WorldRow = memo(function WorldRow({ instance, world, onCopy, onPacks, onPreview }: { instance: Instance; world: World; onCopy: (w: World) => void; onPacks: (w: World) => void; onPreview: (w: World) => void }) {
  const t = useT();
  const { launch } = useInstanceActions();
  const { phase } = useRunPhase(instance.id);
  const quick = supportsQuickPlay(instance.mc_version);
  const openDir = () => api.instanceOpenFolder(instance.id, `saves/${world.folder}`).catch((e) => toast.error(e));
  const gm = world.game_mode?.toLowerCase() ?? null;
  const mode = worldModeLabel(world.game_mode, t);
  const meta = [mode, world.last_played ? formatRelative(world.last_played) : null, formatBytes(world.size)].filter(Boolean).join(" · ");
  return (
    <ContextMenu
      content={
        <>
          <ContextLabel>{world.name}</ContextLabel>
          <WorldMenu instance={instance} world={world} onCopy={onCopy} onPacks={onPacks} onPreview={onPreview} Item={ContextItem} Sep={ContextSeparator} />
        </>
      }
    >
      <div
        onDoubleClick={openDir}
        title={`saves/${world.folder}`}
        className="group flex h-12 items-center gap-3 px-6 transition-colors duration-100 hover:bg-white/[.03] data-[state=open]:bg-white/[.04]"
      >
        <WorldIcon world={world} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-text">{world.name}</span>
            {gm === "hardcore" && <Tag color="#ff5470">{mode}</Tag>}
          </div>
          <div className="truncate text-[12px] leading-tight text-dim">{meta}</div>
        </div>
        {quick && (
          <IconButton
            label={t("home.world_play", { name: world.name })}
            tip
            size="sm"
            variant="ghost"
            disabled={phase !== "idle"}
            className="text-accent opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => launch(instance, world.folder)}
          >
            <Play size={14} fill="currentColor" />
          </IconButton>
        )}
        <IconButton
          label={t("world_map.open", { name: world.name })}
          size="sm"
          variant="ghost"
          tip
          onClick={() => onPreview(world)}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <Map size={16} />
        </IconButton>
        <DropdownMenu
          trigger={
            <IconButton label={t("common.more")} size="sm" variant="ghost" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          <WorldMenu instance={instance} world={world} onCopy={onCopy} onPacks={onPacks} onPreview={onPreview} Item={DropdownItem} Sep={DropdownSeparator} />
        </DropdownMenu>
      </div>
    </ContextMenu>
  );
});

export function WorldsTab({ instance }: { instance: Instance }) {
  const t = useT();
  const q = useQuery({ queryKey: qk.worlds(instance.id), queryFn: () => api.worldsList(instance.id) });
  const [query, setQuery] = useState("");
  const [copying, setCopying] = useState<World | null>(null);
  const [packsWorld, setPacksWorld] = useState<World | null>(null);
  const [previewing, setPreviewing] = useState<World | null>(null);
  const dq = useDeferredValue(query.trim().toLowerCase());
  const list = useMemo(
    () =>
      (q.data ?? [])
        .filter((w) => !dq || w.name.toLowerCase().includes(dq) || w.folder.toLowerCase().includes(dq))
        .sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0)),
    [q.data, dq],
  );

  return (
    <div data-tour="worlds-list" className="scroll h-full">
      <PageTools>
        <SearchInput value={query} onChange={setQuery} placeholder={t("worlds.search")} className="w-[240px] min-w-[140px] shrink" />
        <div className="flex-1" />
        {/* Beschriftete Hauptaktion statt zwei unklarer Symbole (wie „Server hinzufügen“ nebenan) */}
        <IconButton label={t("worlds.open_saves_tip")} tip variant="ghost" onClick={() => api.instanceOpenFolder(instance.id, "saves").catch((e) => toast.error(e))}>
          <FolderOpen size={16} />
        </IconButton>
        <Button variant="ghost" icon={<FileArchive size={15} />} title={t("worlds.import")} onClick={() => importWorldZip(instance)}>
          {t("worlds.import_short")}
        </Button>
      </PageTools>
      <VoiceWorldHint instance={instance} />
      <div className="pb-6">
        {q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="flex flex-col">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex h-12 items-center gap-3 px-6">
                <Skeleton className="h-9 w-9" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : q.data.length === 0 ? (
          <EmptyState
            icon="globe"
            title={t("worlds.empty.title")}
            text={t("worlds.empty.text")}
            action={
              <Button size="sm" variant="ghost" icon={<FileArchive size={14} />} onClick={() => importWorldZip(instance)}>
                {t("worlds.import")}
              </Button>
            }
          />
        ) : list.length === 0 ? (
          <EmptyState
            icon="search_none"
            title={t("instances.no_match")}
            text={t("worlds.no_match", { q: query.trim() })}
            action={
              <Button size="sm" onClick={() => setQuery("")}>
                {t("layout.search.reset")}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col">
            {list.map((w) => (
              <WorldRow key={w.folder} instance={instance} world={w} onCopy={setCopying} onPacks={setPacksWorld} onPreview={setPreviewing} />
            ))}
          </div>
        )}
      </div>
      <CopyWorldDialog instance={instance} world={copying} onClose={() => setCopying(null)} />
      {packsWorld && <WorldDatapacksDialog instanceId={instance.id} world={packsWorld} onClose={() => setPacksWorld(null)} />}
      {previewing && <WorldPreviewDialog key={`${instance.id}:${previewing.folder}`} instanceId={instance.id} world={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}
