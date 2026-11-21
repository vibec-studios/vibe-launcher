import type { OptSyncCategory, OptSyncInfo } from "@/lib/types";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { ALL } from "./shared";

export function CategoryChips({
  value,
  onChange,
  counts,
}: {
  value: OptSyncCategory[];
  onChange: (v: OptSyncCategory[]) => void;
  counts?: OptSyncInfo["counts"];
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-medium transition-colors duration-100",
              on ? "bg-accent/15 text-text hover:bg-accent/20" : "bg-white/[.05] text-muted hover:bg-white/[.08] hover:text-text",
            )}
          >
            {t(`optsync.cat.${c}`)}
            {counts && <span className="text-caption tabular-nums text-dim">{counts[c] ?? 0}</span>}
          </button>
        );
      })}
    </div>
  );
}
