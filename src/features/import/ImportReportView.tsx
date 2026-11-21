import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Info } from "lucide-react";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import type { ImportReport } from "@/lib/types";

function Group({ title, hint, items, tone }: { title: string; hint: string; items: string[]; tone: "warn" | "info" }) {
  if (!items.length) return null;
  const Icon = tone === "warn" ? AlertTriangle : Info;
  return (
    <details className="group/rep">
      <summary className={cn("flex cursor-default list-none items-center gap-1.5 text-[12px]", tone === "warn" ? "text-warn" : "text-muted")}>
        <ChevronRight size={12} className="shrink-0 transition-transform duration-150 group-open/rep:rotate-90" />
        <Icon size={12} className="shrink-0" />
        <span className="truncate">{title}</span>
      </summary>
      <div className="mt-1 flex flex-col gap-1 pl-[30px]">
        <p className="text-[11.5px] leading-snug text-dim">{hint}</p>
        <ul className="selectable flex flex-col gap-0.5 text-[12px] text-muted">
          {items.map((n, i) => (
            <li key={`${n}-${i}`} className="break-words">
              {n}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function ReportDetails({ r }: { r: ImportReport }) {
  const tr = useT();
  const counts = [
    r.mods.length > 0 && tr("ext.rep.mods", { n: r.mods.length }),
    r.jars.length > 0 && tr("ext.rep.jars", { n: r.jars.length }),
    r.files > 0 && tr("ext.rep.files", { n: r.files }),
    r.sync_packs.length > 0 && tr("ext.rep.sync", { list: r.sync_packs.join(", ") }),
  ].filter(Boolean);
  const problems = r.failed.length + r.locked.length + r.unfit.length + r.norisk_only.length;
  return (
    <div className="flex flex-col gap-1">
      {counts.length > 0 && <div className="text-[12px] text-muted">{counts.join(" · ")}</div>}
      <Group title={tr("ext.rep.failed", { n: r.failed.length })} hint={tr("ext.rep.failed_hint")} items={r.failed.map((f) => `${f.name} – ${f.reason}`)} tone="warn" />
      <Group title={tr("ext.rep.locked", { n: r.locked.length })} hint={tr("ext.rep.locked_hint")} items={r.locked} tone="warn" />
      <Group title={tr("ext.rep.cache", { n: r.from_cache.length })} hint={tr("ext.rep.cache_hint")} items={r.from_cache} tone="info" />
      <Group title={tr("ext.rep.norisk", { n: r.norisk_only.length })} hint={tr("ext.rep.norisk_hint")} items={r.norisk_only} tone="info" />
      <Group title={tr("ext.rep.unfit", { n: r.unfit.length })} hint={tr("ext.rep.unfit_hint")} items={r.unfit} tone="info" />
      {problems === 0 && <div className="text-[12px] text-ok">{tr("ext.rep.all_ok")}</div>}
    </div>
  );
}

export function ImportReportView({ instanceId, fallback }: { instanceId: string; fallback: string | null }) {
  const q = useQuery({ queryKey: ["import-report", instanceId], queryFn: () => api.importReport(instanceId), staleTime: Infinity, retry: 0 });
  if (q.data) return <ReportDetails r={q.data} />;
  return fallback ? <div className="selectable break-words text-[12px] text-muted">{fallback}</div> : null;
}
