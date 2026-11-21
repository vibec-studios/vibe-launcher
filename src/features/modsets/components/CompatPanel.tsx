import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { ErrorState, Skeleton, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { loaderNames } from "@/lib/format";
import { setsApi, type ModSetInfo } from "../api";

export function cellTone(n: number, total: number) {
  if (!total || n === 0) return "bg-white/[.03] text-dim";
  if (n === total) return "bg-ok/20 text-ok";
  if (n / total >= 0.75) return "bg-ok/10 text-text";
  return "bg-warn/10 text-muted";
}

export function CompatPanel({ set }: { set: ModSetInfo }) {
  const t = useT();
  const q = useQuery({ queryKey: ["mod-sets", "compat", set.id, set.updated], queryFn: () => setsApi.compat(set.id), staleTime: 10 * 60_000 });
  if (!set.entries.length) return <div className="py-10 text-center text-[13px] text-muted">{t("sets.content_empty")}</div>;
  if (q.isPending)
    return (
      <div className="flex flex-col gap-2">
        <div className="text-[13px] text-muted">{t("sets.compat.loading")}</div>
        <Skeleton className="h-[180px]" />
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const cell = (mc: string, l: string) => c.cells.find((x) => x.mc === mc && x.loader === l)?.available ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[14px] font-semibold text-text">{t("sets.compat.title")}</div>
        <div className="mt-0.5 text-[13px] text-muted">{t("sets.compat.text")}</div>
      </div>
      {c.best && (
        <div className="flex items-center gap-2 rounded-card bg-ok/[.08] px-3 py-2.5 text-[13px] text-text">
          <Check size={15} className="shrink-0 text-ok" />
          {c.best.available === c.total
            ? t("sets.compat.best_all", { mc: c.best.mc, loader: loaderNames[c.best.loader] })
            : t("sets.compat.best", { mc: c.best.mc, loader: loaderNames[c.best.loader], n: c.best.available, total: c.total })}
        </div>
      )}
      <div className="scroll overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-[12.5px]">
          <thead>
            <tr>
              <th className="w-[96px]" />
              {c.mc_versions.map((mc) => (
                <th key={mc} className="px-1 pb-1 text-center font-semibold tabular-nums text-muted">
                  {mc}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.loaders.map((l) => (
              <tr key={l}>
                <td className="pr-2 font-semibold text-text">{l === "vanilla" ? t("sets.compat.loaderless") : loaderNames[l]}</td>
                {c.mc_versions.map((mc) => {
                  const n = cell(mc, l);
                  return (
                    <td key={mc} className="p-0">
                      <Tooltip content={t("sets.compat.cell", { n, total: c.total, mc, loader: l === "vanilla" ? t("sets.compat.loaderless") : loaderNames[l] })}>
                        <div className={cn("grid h-9 place-items-center rounded-xs font-semibold tabular-nums", cellTone(n, c.total))}>
                          {n === c.total ? <Check size={14} /> : `${n}/${c.total}`}
                        </div>
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
