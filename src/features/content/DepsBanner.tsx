// OWNER: Content-Agent. Abhängigkeits-Check im Inhalte-Tab: fehlende/inkompatible/doppelte Mods mit Ein-Klick-Lösungen.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronUp, Download, PowerOff, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Spinner, cn, toast } from "@/components/ui";
import { startContentInstall } from "@/components/content/install";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { DepFix, DepIssue } from "@/lib/types";

export function DepsBanner({ instanceId }: { instanceId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["content", instanceId, "deps"], queryFn: () => api.contentCheckDeps(instanceId), staleTime: 30_000 });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const issues = q.data ?? [];
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.severity === "error").length;

  const run = async (key: string, fix: DepFix) => {
    setBusy(key);
    try {
      if (fix.action === "install") await startContentInstall(instanceId, { source: fix.source, id: fix.project_id, title: fix.title });
      else if (fix.action === "remove") await api.contentRemove(instanceId, "mod", fix.file_names);
      else await api.contentSetEnabled(instanceId, "mod", fix.file_name, false);
      queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const label = (i: DepIssue, f: DepFix) =>
    f.action === "install"
      ? t("deps.fix.install", { title: f.title })
      : f.action === "remove"
        ? t("deps.fix.remove")
        : t("deps.fix.disable", { name: f.file_name === i.file_name ? i.mod_name : f.file_name.replace(/\.jar(\.disabled)?$/, "") });

  return (
    <div className={cn("mx-4 mb-2 border", errors ? "border-danger/35 bg-danger/[.06]" : "border-warn/35 bg-warn/[.05]")}>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <AlertTriangle size={16} className={cn("shrink-0", errors ? "text-danger" : "text-warn")} />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-white">{errors ? t("deps.title", { n: issues.length }) : t("deps.title_warn", { n: issues.length })}</div>
          {!open && <div className="truncate text-[12.5px] text-muted">{issues[0].message}</div>}
        </div>
        <button className="flex h-7 items-center gap-1 px-2 text-[12.5px] text-muted hover:text-white" onClick={() => void q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Spinner size={11} /> : <RefreshCw size={13} />}
          {t("deps.recheck")}
        </button>
        <button className="flex h-7 items-center gap-1 px-2 text-[12.5px] font-medium text-text hover:bg-white/[.06]" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {open ? t("deps.hide") : t("deps.show")}
        </button>
      </div>
      {open && (
        <div className="scroll max-h-[240px] border-t border-line/70">
          {issues.map((i, n) => (
            <div key={n} className="flex items-center gap-3 border-b border-line/50 px-3.5 py-2 last:border-b-0">
              <span className={cn("w-[74px] shrink-0 text-[11.5px] font-semibold", i.severity === "error" ? "text-danger" : "text-warn")}>{t(`deps.kind.${i.kind}`)}</span>
              <span className="selectable min-w-0 flex-1 text-[13px] text-text">{i.message}</span>
              <div className="flex shrink-0 gap-1">
                {i.fixes.slice(0, 2).map((f, k) => {
                  const key = `${n}-${k}`;
                  return (
                    <button
                      key={k}
                      disabled={busy !== null}
                      onClick={() => void run(key, f)}
                      className={cn(
                        "flex h-7 items-center gap-1.5 border px-2 text-[12.5px] font-medium transition-colors duration-100 disabled:opacity-50",
                        k === 0 ? "border-line2 bg-surface2 text-white hover:bg-surface3" : "border-transparent text-muted hover:text-white",
                      )}
                    >
                      {busy === key ? <Spinner size={11} /> : f.action === "install" ? <Download size={13} /> : f.action === "remove" ? <Trash2 size={13} /> : <PowerOff size={13} />}
                      {label(i, f)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
