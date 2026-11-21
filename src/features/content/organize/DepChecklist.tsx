import { Checkbox, cn } from "@/components/ui";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { useT } from "@/i18n";

export interface DepRow {
  key: string;
  name: string;
  icon?: string | null;
  detail?: string | null;
  enabled: boolean;
}

export function DepChecklist({ rows, picked, onChange }: { rows: DepRow[]; picked: Set<string>; onChange: (next: Set<string>) => void }) {
  const t = useT();
  const all = rows.length > 0 && rows.every((r) => picked.has(r.key));
  const some = rows.some((r) => picked.has(r.key));
  return (
    <div className="overflow-hidden rounded-card border border-line bg-panel">
      {rows.length > 1 && (
        <label className="flex h-10 cursor-pointer items-center gap-3 border-b border-line bg-surface px-3 text-[12.5px] font-semibold text-muted">
          <Checkbox checked={all} mixed={some && !all} onChange={(v) => onChange(v ? new Set(rows.map((r) => r.key)) : new Set())} label={t("common.select_all")} />
          {t("common.select_all")}
        </label>
      )}
      <div className="scroll max-h-[300px]">
        {rows.map((r) => {
          const on = picked.has(r.key);
          return (
            <label key={r.key} className={cn("flex min-h-[52px] cursor-pointer items-center gap-3 border-t border-line px-3 py-2 first:border-t-0 hover:bg-white/[.025]")}>
              <Checkbox
                checked={on}
                label={r.name}
                onChange={(v) => {
                  const next = new Set(picked);
                  if (v) next.add(r.key);
                  else next.delete(r.key);
                  onChange(next);
                }}
              />
              <ProjectIcon src={r.icon ?? null} size={32} />
              <div className="min-w-0 flex-1">
                <div className={cn("truncate text-[13.5px] font-semibold text-text", !r.enabled && "opacity-60")}>{r.name}</div>
                {r.detail && <div className="truncate text-[12px] text-dim">{r.detail}</div>}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
