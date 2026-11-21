import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { ServerPlayerEntry } from "@/lib/types";
import { ContextItem, ContextMenu, IconButton } from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { useT } from "@/i18n";
import { rowCls } from "./playerActions";

export function EntryRow({ entry, right, onRemove, mono }: { entry: ServerPlayerEntry; right?: ReactNode; onRemove: () => void; mono?: boolean }) {
  const t = useT();
  return (
    <ContextMenu
      content={
        <ContextItem icon={<X size={14} />} danger onSelect={onRemove}>
          {t("common.remove")}
        </ContextItem>
      }
    >
      <div className={rowCls}>
        {!mono && <PlayerHead uuid={entry.uuid ?? entry.name} name={entry.name} size={24} />}
        <div className="min-w-0 flex-1">
          <div className={mono ? "selectable truncate font-mono text-[13px] text-text" : "selectable truncate text-[13px] font-medium text-text"}>{entry.name}</div>
          {entry.reason && <div className="truncate text-caption text-dim">{entry.reason}</div>}
        </div>
        {right}
        <IconButton label={t("common.remove")} tip variant="ghost" size="sm" className="opacity-60 group-hover:opacity-100" onClick={onRemove}>
          <X size={14} />
        </IconButton>
      </div>
    </ContextMenu>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-10 text-center text-[13px] text-dim">{children}</div>;
}
