import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { InstanceTab } from "@/app/router";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";

export interface SubItem {
  value: InstanceTab;
  label: string;
  count?: number;
}

/** Welten | Server als kompakter Segment-Umschalter links in der Werkzeugzeile. */
export function SubNav({ items, value, onChange }: { items: SubItem[]; value: InstanceTab; onChange: (v: InstanceTab) => void }) {
  const t = useT();
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-ctl bg-field p-0.5" role="tablist" aria-label={t("ipage.sub.label")}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-[max(0px,calc(var(--r-ctl)-2px))] px-3 text-[13px] font-semibold whitespace-nowrap transition-colors duration-100",
              active ? "bg-surface3 text-text" : "text-muted hover:text-text",
            )}
          >
            {it.label}
            {it.count !== undefined && <span className={cn("text-[11.5px] font-medium tabular-nums", active ? "text-muted" : "text-dim")}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function useWorldItems(id: string, enabled: boolean): SubItem[] {
  const t = useT();
  const worlds = useQuery({ queryKey: qk.worlds(id), queryFn: () => api.worldsList(id), enabled });
  const servers = useQuery({ queryKey: ["servers", id], queryFn: () => api.instanceServersList(id), enabled });
  return [
    { value: "worlds", label: t("inst.tab.worlds"), count: worlds.data?.length },
    { value: "servers", label: t("inst.tab.servers"), count: servers.data?.length },
  ];
}
