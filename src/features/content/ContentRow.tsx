// Zeile der Inhalte-Tabelle (Stil Modrinth App). memo + stabile Aktionen -> beim Umschalten/Auswählen rendert nur
// die betroffene Zeile neu.
import { ArrowUpCircle, Check, ExternalLink, FolderOpen, MoreVertical, Power, PowerOff, RefreshCw, Trash2 } from "lucide-react";
import { memo, type MouseEvent } from "react";
import { ContextItem, ContextMenu, ContextSeparator, DropdownItem, DropdownMenu, DropdownSeparator, Switch, Tooltip, cn, type MenuItemProps } from "@/components/ui";
import { useT } from "@/i18n";
import type { ContentItem, ContentUpdate } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { sourceNames } from "@/components/content/util";

export const ROW_H = 52;
/** Spalten: Auswahl | Name | Version | Aktionen */
export const GRID = "grid grid-cols-[18px_minmax(0,1fr)_minmax(0,190px)_88px] items-center gap-3 px-4 @min-[820px]:grid-cols-[18px_minmax(0,1fr)_minmax(0,260px)_88px]";

export interface RowActions {
  click: (key: string, e: MouseEvent) => void;
  toggle: (key: string) => void;
  context: (key: string) => void;
  /** Ziel-Einträge eines Menüs: Auswahl, falls die Zeile dazugehört */
  menuTargets: (key: string) => ContentItem[];
  setEnabled: (items: ContentItem[], enabled: boolean) => void;
  update: (items: ContentItem[]) => void;
  remove: (items: ContentItem[]) => void;
  openProject: (item: ContentItem) => void;
  openFolder: () => void;
  hasUpdate: (item: ContentItem) => boolean;
}

function RowMenu({ itemKey, actions, Item, Sep }: { itemKey: string; actions: RowActions; Item: (p: MenuItemProps) => React.ReactNode; Sep: () => React.ReactNode }) {
  const t = useT();
  const items = actions.menuTargets(itemKey);
  const n = items.length;
  const one = n === 1 ? items[0] : null;
  const anyOn = items.some((i) => i.enabled);
  const anyOff = items.some((i) => !i.enabled);
  const upd = items.filter(actions.hasUpdate);
  return (
    <>
      {anyOff && (
        <Item icon={<Power size={14} />} onSelect={() => actions.setEnabled(items, true)}>
          {n > 1 ? t("content.menu.enable_n", { n }) : t("content.menu.enable")}
        </Item>
      )}
      {anyOn && (
        <Item icon={<PowerOff size={14} />} onSelect={() => actions.setEnabled(items, false)}>
          {n > 1 ? t("content.menu.disable_n", { n }) : t("content.menu.disable")}
        </Item>
      )}
      {upd.length > 0 && (
        <Item icon={<RefreshCw size={14} />} onSelect={() => actions.update(upd)}>
          {upd.length > 1 ? t("content.menu.update_n", { n: upd.length }) : t("common.update")}
        </Item>
      )}
      <Sep />
      {one?.project_id && one.source && (
        <Item icon={<ExternalLink size={14} />} onSelect={() => actions.openProject(one)}>
          {t("content.menu.open_on", { source: sourceNames[one.source] })}
        </Item>
      )}
      <Item icon={<FolderOpen size={14} />} onSelect={actions.openFolder}>
        {t("content.menu.show_folder")}
      </Item>
      <Sep />
      <Item icon={<Trash2 size={14} />} danger onSelect={() => actions.remove(items)} shortcut={t("content.key.delete")}>
        {n > 1 ? t("content.menu.remove_n", { n }) : t("common.remove")}
      </Item>
    </>
  );
}

export function SelectBox({ state, onClick, label }: { state: "on" | "off" | "mixed"; onClick: (e: MouseEvent) => void; label: string }) {
  return (
    <button
      role="checkbox"
      aria-checked={state === "mixed" ? "mixed" : state === "on"}
      aria-label={label}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "grid h-[18px] w-[18px] place-items-center border transition-colors duration-100",
        state === "off" ? "border-line2 hover:border-white/40" : "border-accent bg-accent text-[var(--on-accent)]",
      )}
    >
      {state === "on" ? <Check size={12} strokeWidth={3} /> : state === "mixed" ? <span className="h-0.5 w-2 bg-current" /> : null}
    </button>
  );
}

export const ContentRow = memo(function ContentRow({
  item,
  itemKey,
  selected,
  update,
  actions,
}: {
  item: ContentItem;
  itemKey: string;
  selected: boolean;
  update: ContentUpdate | undefined;
  actions: RowActions;
}) {
  const t = useT();
  const sub = [item.authors.length ? t("discover.by", { author: item.authors.join(", ") }) : null, item.source ? sourceNames[item.source] : t("content.local")]
    .filter(Boolean)
    .join(" · ");
  return (
    <ContextMenu content={<RowMenu itemKey={itemKey} actions={actions} Item={ContextItem} Sep={ContextSeparator} />}>
      <div
        role="row"
        aria-selected={selected}
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        onClick={(e) => actions.click(itemKey, e)}
        onDoubleClick={() => item.project_id && actions.openProject(item)}
        onContextMenu={() => actions.context(itemKey)}
        className={cn(
          GRID,
          "h-full border-b border-line transition-colors duration-100",
          selected ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : "hover:bg-white/[.025]",
        )}
      >
        <SelectBox
          state={selected ? "on" : "off"}
          label={item.name}
          onClick={(e) => {
            e.stopPropagation();
            actions.toggle(itemKey);
          }}
        />
        <div className={cn("flex min-w-0 items-center gap-3 transition-opacity duration-150", !item.enabled && "opacity-50")}>
          <ProjectIcon src={item.icon} size={34} className={cn(!item.enabled && "grayscale")} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-white">{item.name}</div>
            <div className="truncate text-[12px] text-dim">{sub}</div>
          </div>
        </div>
        <div className={cn("min-w-0 transition-opacity duration-150", !item.enabled && "opacity-50")}>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] text-text" title={item.version ?? ""}>
              {item.version ?? "–"}
            </span>
            {update && (
              <Tooltip content={t("content.update_to", { version: update.new_version.version_number })}>
                <span className="shrink-0 text-accent">
                  <ArrowUpCircle size={14} />
                </span>
              </Tooltip>
            )}
          </div>
          <div className="truncate font-mono text-[11px] text-dim" title={item.file_name}>
            {item.file_name}
          </div>
        </div>
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Switch checked={item.enabled} onChange={(v) => actions.setEnabled([item], v)} label={item.enabled ? t("content.menu.disable") : t("content.menu.enable")} />
          <DropdownMenu
            trigger={
              <button
                aria-label={t("common.more")}
                className="grid h-8 w-8 place-items-center text-dim transition-colors duration-100 hover:bg-white/[.06] hover:text-white data-[state=open]:bg-white/[.06] data-[state=open]:text-white"
              >
                <MoreVertical size={16} />
              </button>
            }
          >
            <RowMenu itemKey={itemKey} actions={actions} Item={DropdownItem} Sep={DropdownSeparator} />
          </DropdownMenu>
        </div>
      </div>
    </ContextMenu>
  );
});

export function RowSkeleton() {
  return (
    <div className={cn(GRID, "h-[52px] border-b border-line")}>
      <div className="skeleton h-[18px] w-[18px]" />
      <div className="flex items-center gap-3">
        <div className="skeleton h-[34px] w-[34px] shrink-0" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="skeleton h-3.5 w-2/5" />
          <div className="skeleton h-2.5 w-1/4" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="skeleton h-3 w-16" />
        <div className="skeleton h-2.5 w-28" />
      </div>
      <div className="skeleton ml-auto h-5 w-9" />
    </div>
  );
}
