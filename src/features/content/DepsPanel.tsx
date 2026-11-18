// OWNER: Content-Agent. Abhängigkeits-Check: fehlende/inkompatible/doppelte Mods mit Ein-Klick-Lösungen.
// Wird in der Hinweiszeile der Instanzseite als Popover gezeigt (früher: eigenes Banner im Inhalte-Tab).
import { useQuery } from "@tanstack/react-query";
import { Download, PowerOff, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Spinner, cn, toast } from "@/components/ui";
import { startContentInstall } from "@/components/content/install";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { DepFix, DepIssue } from "@/lib/types";

export function useDepIssues(instanceId: string, enabled = true) {
  return useQuery({ queryKey: ["content", instanceId, "deps"], queryFn: () => api.contentCheckDeps(instanceId), staleTime: 30_000, enabled });
}

export function DepsPanel({ instanceId }: { instanceId: string }) {
  const t = useT();
  const q = useDepIssues(instanceId);
  const [busy, setBusy] = useState<string | null>(null);
  const issues = q.data ?? [];
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
    <div>
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-white">
            {issues.length === 0 ? t("deps.fixed") : errors ? t("deps.title", { n: issues.length }) : t("deps.title_warn", { n: issues.length })}
          </div>
          {errors > 0 && <div className="mt-0.5 text-[12.5px] text-muted">{t("deps.text")}</div>}
        </div>
        <button
          className="flex h-7 shrink-0 items-center gap-1.5 px-2 text-[12.5px] text-muted transition-colors hover:bg-white/[.06] hover:text-white"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
        >
          {q.isFetching ? <Spinner size={11} /> : <RefreshCw size={13} />}
          {t("deps.recheck")}
        </button>
      </div>
      <div className="scroll max-h-[320px]">
        {issues.map((i, n) => (
          <div key={n} className="flex flex-col gap-2 border-b border-line/60 px-4 py-2.5 last:border-b-0">
            <div className="flex items-start gap-2.5">
              <span className={cn("mt-px w-[68px] shrink-0 text-[11.5px] font-semibold", i.severity === "error" ? "text-danger" : "text-warn")}>
                {t(`deps.kind.${i.kind}`)}
              </span>
              <span className="selectable min-w-0 flex-1 text-[13px] text-text">{i.message}</span>
            </div>
            {i.fixes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-[78px]">
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
                      {busy === key ? (
                        <Spinner size={11} />
                      ) : f.action === "install" ? (
                        <Download size={13} />
                      ) : f.action === "remove" ? (
                        <Trash2 size={13} />
                      ) : (
                        <PowerOff size={13} />
                      )}
                      {label(i, f)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
