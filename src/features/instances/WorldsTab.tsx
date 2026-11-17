// Welten einer Instanz (saves/). Rechtsklick: Ordner öffnen, Löschen.
import { memo, useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Globe2, Trash2 } from "lucide-react";
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
  EmptyState,
  ErrorState,
  IconButton,
  SearchInput,
  Skeleton,
  Tag,
  Tooltip,
  confirm,
  toast,
} from "@/components/ui";
import { PixelBlock } from "@/components/instance/InstanceIcon";
import { useT } from "@/i18n";

const MODES = ["survival", "creative", "adventure", "spectator", "hardcore"];
const wrap = "mx-auto w-full max-w-[1320px] px-8";

function WorldIcon({ world }: { world: World }) {
  const [failed, setFailed] = useState(false);
  const src = imageSrc(world.icon);
  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden border border-line bg-surface2">
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
        <PixelBlock color="#5fbf4a" size={30} />
      )}
    </div>
  );
}

const WorldRow = memo(function WorldRow({ instance, world }: { instance: Instance; world: World }) {
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
  const gm = world.game_mode?.toLowerCase() ?? null;
  const mode = gm ? (MODES.includes(gm) ? t(`worlds.mode.${gm}`) : world.game_mode) : null;
  return (
    <ContextMenu
      content={
        <>
          <ContextLabel>{world.name}</ContextLabel>
          <ContextItem icon={<FolderOpen size={14} />} onSelect={openDir}>
            {t("common.open_folder")}
          </ContextItem>
          <ContextSeparator />
          <ContextItem icon={<Trash2 size={14} />} danger onSelect={del}>
            {t("common.delete")}
          </ContextItem>
        </>
      }
    >
      <div
        onDoubleClick={openDir}
        className="group flex items-center gap-4 border border-line bg-surface px-3.5 py-3 transition-[background-color,border-color,box-shadow] duration-150 hover:border-line2 hover:bg-surface2 hover:shadow-[inset_3px_0_0_var(--accent)] data-[state=open]:border-line2 data-[state=open]:bg-surface2 data-[state=open]:shadow-[inset_3px_0_0_var(--accent)]"
      >
        <WorldIcon world={world} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-white">{world.name}</div>
          <div className="truncate font-mono text-[11px] text-dim">saves/{world.folder}</div>
        </div>
        {mode && <Tag color={gm === "hardcore" ? "#ff5470" : undefined}>{mode}</Tag>}
        <div className="w-[120px] text-right font-mono text-[11px] text-muted">{world.last_played ? formatRelative(world.last_played) : "–"}</div>
        <div className="w-[80px] text-right font-mono text-[11px] text-dim">{formatBytes(world.size)}</div>
        <div className="flex w-[76px] justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <Tooltip content={t("common.open_folder")}>
            <IconButton label={t("common.open_folder")} size="sm" className="border-transparent hover:border-line2" onClick={openDir}>
              <FolderOpen size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip content={t("common.delete")}>
            <IconButton label={t("common.delete")} size="sm" className="border-transparent text-danger hover:border-danger/50" onClick={del}>
              <Trash2 size={14} />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </ContextMenu>
  );
});

export function WorldsTab({ instance }: { instance: Instance }) {
  const t = useT();
  const q = useQuery({ queryKey: qk.worlds(instance.id), queryFn: () => api.worldsList(instance.id) });
  const [query, setQuery] = useState("");
  const dq = useDeferredValue(query.trim().toLowerCase());
  const list = useMemo(
    () =>
      (q.data ?? [])
        .filter((w) => !dq || w.name.toLowerCase().includes(dq) || w.folder.toLowerCase().includes(dq))
        .sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0)),
    [q.data, dq],
  );

  return (
    <div className="scroll h-full">
      <div className={`${wrap} flex flex-col gap-4 py-6`}>
        <div className="flex items-center gap-3">
          <SearchInput value={query} onChange={setQuery} placeholder={t("worlds.search")} className="max-w-[320px] flex-1" />
          <span className="font-mono text-[11px] text-dim">{q.data ? t("worlds.count", { n: q.data.length }) : ""}</span>
          <div className="flex-1" />
          <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => api.instanceOpenFolder(instance.id, "saves").catch((e) => toast.error(e))}>
            {t("worlds.open_saves")}
          </Button>
        </div>
        {q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 border border-line bg-surface px-3.5 py-3">
                <Skeleton className="h-12 w-12" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : q.data.length === 0 ? (
          <EmptyState icon={<Globe2 size={34} />} title={t("worlds.empty.title")} text={t("worlds.empty.text")} />
        ) : list.length === 0 ? (
          <EmptyState title={t("instances.no_match")} />
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((w) => (
              <WorldRow key={w.folder} instance={instance} world={w} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
