import { memo } from "react";
import { ArrowDown, ArrowUp, Copy, Map as MapIcon, MoreHorizontal, Pencil, Play, Server, Trash2 } from "lucide-react";
import type { Instance, ServerEntry } from "@/lib/types";
import { ContextItem, ContextMenu, ContextSeparator, DropdownItem, DropdownMenu, DropdownSeparator, IconButton, Skeleton, Tooltip, toast, type MenuItemProps } from "@/components/ui";
import { useInstanceActions } from "@/components/instance/actions";
import { Motd, PingBars, usePing } from "@/components/instance/motd";
import { useT } from "@/i18n";

export function Favicon({ entry, ping }: { entry: ServerEntry; ping: string | null | undefined }) {
  const src = ping ?? (entry.icon ? `data:image/png;base64,${entry.icon}` : null);
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface2">
      {src ? <img src={src} alt="" className="h-full w-full [image-rendering:pixelated]" /> : <Server size={17} className="text-dim" />}
    </div>
  );
}

export interface RowMenuProps {
  entry: ServerEntry;
  index: number;
  count: number;
  locked: boolean;
  join: () => void;
  onMap: (() => void) | null;
  onEdit: (i: number) => void;
  onMove: (i: number, d: -1 | 1) => void;
  onRemove: (i: number) => void;
  Item: (p: MenuItemProps) => React.ReactNode;
  Sep: () => React.ReactNode;
}

/** Dieselben Einträge im ⋯-Menü und im Rechtsklick-Menü. */
export function RowMenu({ entry, index, count, locked, join, onMap, onEdit, onMove, onRemove, Item, Sep }: RowMenuProps) {
  const t = useT();
  return (
    <>
      <Item icon={<Play size={14} />} disabled={locked} onSelect={join}>
        {t("servers.join")}
      </Item>
      {onMap && (
        <Item icon={<MapIcon size={14} />} onSelect={onMap}>
          {t("mod_map.server_open")}
        </Item>
      )}
      <Item icon={<Pencil size={14} />} disabled={locked} onSelect={() => onEdit(index)}>
        {t("servers.edit")}
      </Item>
      <Item icon={<Copy size={14} />} onSelect={() => navigator.clipboard?.writeText(entry.ip).then(() => toast.success(t("common.copied")))}>
        {t("servers.copy_address")}
      </Item>
      <Sep />
      <Item icon={<ArrowUp size={14} />} disabled={locked || index === 0} onSelect={() => onMove(index, -1)}>
        {t("servers.up")}
      </Item>
      <Item icon={<ArrowDown size={14} />} disabled={locked || index === count - 1} onSelect={() => onMove(index, 1)}>
        {t("servers.down")}
      </Item>
      <Sep />
      <Item icon={<Trash2 size={14} />} danger disabled={locked} onSelect={() => onRemove(index)}>
        {t("common.remove")}
      </Item>
    </>
  );
}

export const ServerRow = memo(function ServerRow({
  instance,
  entry,
  index,
  count,
  locked,
  hasMap,
  onShowMap,
  onEdit,
  onMove,
  onRemove,
}: {
  instance: Instance;
  entry: ServerEntry;
  index: number;
  count: number;
  locked: boolean;
  hasMap: boolean;
  onShowMap: (entry: ServerEntry) => void;
  onEdit: (i: number) => void;
  onMove: (i: number, d: -1 | 1) => void;
  onRemove: (i: number) => void;
}) {
  const t = useT();
  const { launch } = useInstanceActions();
  const ping = usePing(entry.ip);
  const s = ping.data;
  const join = () => launch(instance, null, entry.ip);
  const onMap = hasMap ? () => onShowMap(entry) : null;
  const menu = { entry, index, count, locked, join, onMap, onEdit, onMove, onRemove };
  return (
    <ContextMenu content={<RowMenu {...menu} Item={ContextItem} Sep={ContextSeparator} />}>
      <div
        onDoubleClick={() => !locked && join()}
        className="group flex h-14 items-center gap-3 px-6 transition-colors duration-100 hover:bg-white/[.03] data-[state=open]:bg-white/[.04]"
      >
        <Favicon entry={entry} ping={s?.favicon} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-text">{entry.name}</span>
            <span className="truncate font-mono text-[11px] text-dim">{entry.ip}</span>
          </div>
          {ping.isLoading ? (
            <Skeleton className="mt-1 h-3 w-56" />
          ) : s?.online ? (
            <Motd text={s.motd || "–"} className="line-clamp-1 text-[12px] leading-tight" />
          ) : (
            <div className="truncate text-[12px] leading-tight text-danger">{s?.error ?? t("servers.offline")}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[12px] text-muted">
          {s?.online && s.players_online != null && (
            <Tooltip content={s.players_sample.length ? s.players_sample.join(", ") : null}>
              <span className="tabular-nums">
                {s.players_online}/{s.players_max}
              </span>
            </Tooltip>
          )}
          <Tooltip content={s?.online ? [`${s.latency_ms} ms`, s.version].filter(Boolean).join(" · ") : null}>
            <span className="flex items-center">
              <PingBars status={s} />
            </span>
          </Tooltip>
        </div>
        {onMap && (
          <IconButton label={t("mod_map.server_open_named", { name: entry.name })} tip size="sm" variant="ghost" onClick={onMap}>
            <MapIcon size={15} />
          </IconButton>
        )}
        <IconButton label={t("servers.join_with", { name: instance.name })} tip size="sm" variant="ghost" disabled={locked} className="text-accent" onClick={join}>
          <Play size={14} fill="currentColor" />
        </IconButton>
        <DropdownMenu
          trigger={
            <IconButton label={t("common.more")} size="sm" variant="ghost" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          <RowMenu {...menu} Item={DropdownItem} Sep={DropdownSeparator} />
        </DropdownMenu>
      </div>
    </ContextMenu>
  );
});
