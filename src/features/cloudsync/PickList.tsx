import type { ReactNode } from "react";
import { Checkbox, cn } from "@/components/ui";
import { useT } from "@/i18n";

export interface PickItem {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
}

export function PickList({ items, picked, onChange, className }: { items: PickItem[]; picked: string[]; onChange: (ids: string[]) => void; className?: string }) {
  const t = useT();
  const usable = items.filter((i) => !i.disabled);
  const all = usable.length > 0 && usable.every((i) => picked.includes(i.id));
  const some = usable.some((i) => picked.includes(i.id));
  return (
    <div className={cn("flex flex-col rounded-card bg-surface", className)}>
      <label className="flex h-10 items-center gap-3 border-b border-line px-4 text-[12.5px] font-medium text-muted">
        <Checkbox checked={all} mixed={some} onChange={(v) => onChange(v ? usable.map((i) => i.id) : [])} label={t("cloud.pick.all")} />
        {t("cloud.pick.all")}
        <span className="ml-auto tabular-nums text-dim">
          {picked.length}/{usable.length}
        </span>
      </label>
      <div className="scroll max-h-[300px]">
        {items.map((i) => {
          const on = picked.includes(i.id);
          return (
            <label key={i.id} className={cn("flex min-h-10 items-center gap-3 px-4 py-2 [&+&]:border-t [&+&]:border-line", i.disabled && "opacity-55")}>
              <Checkbox checked={on} disabled={i.disabled} onChange={(v) => onChange(v ? [...picked, i.id] : picked.filter((x) => x !== i.id))} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-text">{i.title}</span>
              {i.meta && <span className="shrink-0 text-[12px] text-dim">{i.meta}</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}
