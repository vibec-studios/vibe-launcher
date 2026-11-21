import { memo } from "react";
import { ChevronRight } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { ContextMenu, cn } from "@/components/ui";
import { useLang, useT } from "@/i18n";
import { FileIcon, dirName, fullDate, useShortDate } from "../util";
import { EntryMenu } from "./menus";
import type { FileActions, Row } from "./rows";

export const TreeRow = memo(function TreeRow({
  row,
  selected,
  opened,
  dirty,
  dropTarget,
  actions,
  onPick,
}: {
  row: Extract<Row, { type: "entry" }>;
  selected: boolean;
  opened: boolean;
  dirty: boolean;
  dropTarget: boolean;
  actions: FileActions;
  onPick: (row: Extract<Row, { type: "entry" }>, how: "click" | "menu") => void;
}) {
  const e = row.entry;
  const t = useT();
  const lang = useLang((s) => s.lang);
  const short = useShortDate();
  const title = `${e.path}\n${t("files.modified")}: ${fullDate(e.modified, lang)}${e.is_dir ? "" : ` · ${formatBytes(e.size)}`}`;
  return (
    <ContextMenu content={<EntryMenu entry={e} actions={actions} />}>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={e.is_dir ? row.open : undefined}
        data-drop-dir={e.is_dir ? e.path : dirName(e.path)}
        data-path={e.path}
        title={title}
        onClick={() => onPick(row, "click")}
        onDoubleClick={() => !e.is_dir && actions.open(e)}
        onContextMenu={() => onPick(row, "menu")}
        className={cn(
          "flex h-full w-full cursor-default select-none items-center gap-1.5 pr-3 text-left text-[13px] transition-colors duration-100",
          selected ? "bg-surface3 text-text" : "text-text hover:bg-white/[.04]",
          opened && "shadow-[inset_2px_0_0_var(--accent)]",
          e.kind === "binary" && !selected && "text-muted",
          dropTarget && "bg-accent/15 outline outline-1 -outline-offset-1 outline-accent",
        )}
        style={{ paddingLeft: 8 + row.depth * 14 }}
      >
        {e.is_dir ? (
          <ChevronRight size={13} className={cn("shrink-0 text-dim transition-transform duration-100", row.open && "rotate-90")} />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <FileIcon entry={e} open={row.open} />
        <span className="min-w-0 flex-1 truncate">{e.name}</span>
        {dirty && <span className="h-1.5 w-1.5 shrink-0 bg-warn" />}
        <span className="w-[58px] shrink-0 text-right text-[11.5px] tabular-nums text-dim">{e.is_dir ? (e.children ?? "") : formatBytes(e.size)}</span>
        <span className="w-[60px] shrink-0 text-right text-[11.5px] tabular-nums text-dim">{short(e.modified)}</span>
      </div>
    </ContextMenu>
  );
});
