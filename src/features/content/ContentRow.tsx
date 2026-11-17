// Eine Zeile im Inhalte-Tab. memo + stabile Aktionen -> beim Umschalten/Auswählen rendert nur die betroffene Zeile neu.
import { ArrowUpCircle, ExternalLink, FolderOpen, Power, PowerOff, RefreshCw, Trash2 } from "lucide-react";
import { memo, type MouseEvent } from "react";
import { ContextItem, ContextMenu, ContextSeparator, Switch, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { ContentItem, ContentUpdate } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { sourceNames } from "@/components/content/util";

export const ROW_H = 56;

export interface RowActions {
  click: (key: string, e: MouseEvent) => void;
  context: (key: string) => void;
  /** Ziel-Einträge eines Kontextmenüs: Auswahl, falls die Zeile dazugehört */
  menuTargets: (key: string) => ContentItem[];
  setEnabled: (items: ContentItem[], enabled: boolean) => void;
  update: (items: ContentItem[]) => void;
  remove: (items: ContentItem[]) => void;
  openProject: (item: ContentItem) => void;
  openFolder: () => void;
  hasUpdate: (item: ContentItem) => boolean;
}

function RowMenu({ itemKey, actions }: { itemKey: string; actions: RowActions }) {
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
        <ContextItem icon={<Power size={14} />} onSelect={() => actions.setEnabled(items, true)}>
          {n > 1 ? t("content.menu.enable_n", { n }) : t("content.menu.enable")}
        </ContextItem>
      )}
      {anyOn && (
        <ContextItem icon={<PowerOff size={14} />} onSelect={() => actions.setEnabled(items, false)}>
          {n > 1 ? t("content.menu.disable_n", { n }) : t("content.menu.disable")}
        </ContextItem>
      )}
      {upd.length > 0 && (
        <ContextItem icon={<RefreshCw size={14} />} onSelect={() => actions.update(upd)}>
          {upd.length > 1 ? t("content.menu.update_n", { n: upd.length }) : t("common.update")}
        </ContextItem>
      )}
      <ContextSeparator />
      {one?.project_id && one.source && (
        <ContextItem icon={<ExternalLink size={14} />} onSelect={() => actions.openProject(one)}>
          {t("content.menu.open_on", { source: sourceNames[one.source] })}
        </ContextItem>
      )}
      <ContextItem icon={<FolderOpen size={14} />} onSelect={actions.openFolder}>
        {t("content.menu.show_folder")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => actions.remove(items)} shortcut={t("content.key.delete")}>
        {n > 1 ? t("content.menu.remove_n", { n }) : t("common.remove")}
      </ContextItem>
    </>
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
  return (
    <ContextMenu content={<RowMenu itemKey={itemKey} actions={actions} />}>
      <div
        role="row"
        aria-selected={selected}
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        onClick={(e) => actions.click(itemKey, e)}
        onDoubleClick={() => item.project_id && actions.openProject(item)}
        onContextMenu={() => actions.context(itemKey)}
        className={cn(
          "grid h-full grid-cols-[36px_minmax(0,1fr)_140px_92px_40px] items-center gap-3.5 border-b border-line px-4 transition-colors duration-100",
          "@min-[820px]:grid-cols-[36px_minmax(0,1fr)_150px_170px_92px_40px]",
          selected ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-white/[.025]",
        )}
      >
        <ProjectIcon src={item.icon} size={36} className={cn("transition-opacity duration-150", !item.enabled && "opacity-40 grayscale")} />
        <div className={cn("min-w-0 transition-opacity duration-150", !item.enabled && "opacity-55")}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-white">{item.name}</span>
            {update && (
              <Tooltip content={t("content.update_to", { version: update.new_version.version_number })}>
                <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[.08em] text-accent">
                  <ArrowUpCircle size={12} />
                  {t("content.update_badge")}
                </span>
              </Tooltip>
            )}
          </div>
          <div className="truncate font-mono text-[11px] text-dim">{item.file_name}</div>
        </div>
        <div className="truncate font-mono text-[12px] text-muted" title={item.version ?? ""}>
          {item.version ?? "–"}
        </div>
        <div className="hidden truncate text-[12.5px] text-muted @min-[820px]:block" title={item.authors.join(", ")}>
          {item.authors.join(", ") || "–"}
        </div>
        <div>
          {item.source ? (
            <span
              className={cn(
                "inline-flex h-5 items-center border px-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[.08em]",
                item.source === "modrinth" ? "border-[#1bd96a]/40 text-[#1bd96a]" : "border-[#f16436]/45 text-[#f16436]",
              )}
            >
              {sourceNames[item.source]}
            </span>
          ) : (
            <span className="inline-flex h-5 items-center border border-line2 px-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-dim">
              {t("content.local")}
            </span>
          )}
        </div>
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Switch checked={item.enabled} onChange={(v) => actions.setEnabled([item], v)} label={item.enabled ? t("content.menu.disable") : t("content.menu.enable")} />
        </div>
      </div>
    </ContextMenu>
  );
});

export function RowSkeleton() {
  return (
    <div className="grid h-[56px] grid-cols-[36px_minmax(0,1fr)_140px_92px_40px] items-center gap-3.5 border-b border-line px-4">
      <div className="skeleton h-9 w-9" />
      <div className="flex flex-col gap-1.5">
        <div className="skeleton h-3.5 w-2/5" />
        <div className="skeleton h-2.5 w-1/3" />
      </div>
      <div className="skeleton h-3 w-20" />
      <div className="skeleton h-5 w-16" />
      <div className="skeleton ml-auto h-5 w-9" />
    </div>
  );
}
