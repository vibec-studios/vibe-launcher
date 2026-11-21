import { Box, Plug, Puzzle } from "lucide-react";
import type { Instance } from "@/lib/types";
import { instanceAccent } from "@/lib/format";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useT } from "@/i18n";
import type { Kind } from "./utils";

export function SummaryCard({ kind, inst, name, summary }: { kind: Kind; inst: Instance | null; name: string; summary: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
      {kind === "instance" && inst ? (
        <InstanceIcon icon={inst.icon} seed={inst.id} accent={instanceAccent(inst.id, inst.accent)} size={40} />
      ) : (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-surface2 text-muted">
          {kind === "plugins" ? <Plug size={18} /> : kind === "mods" ? <Puzzle size={18} /> : <Box size={18} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-text">{name.trim() || t("srv.new.name_placeholder")}</div>
        <div className="truncate text-[12.5px] text-muted">{summary}</div>
      </div>
    </div>
  );
}
