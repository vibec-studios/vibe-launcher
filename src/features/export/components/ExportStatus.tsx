import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Progress } from "@/components/ui";
import { useT } from "@/i18n";
import type { useTask } from "@/lib/queries";

export function ExportStatus({ task, done, failed, error, dest }: { task: ReturnType<typeof useTask>; done: boolean; failed: boolean; error: string | null; dest: string | null }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 animate-fade-in">
      {task && !done && (
        <>
          <div className="flex justify-between">
            <span className="label">{failed ? t("export.failed") : t("export.running")}</span>
            <span className="text-caption tabular-nums text-muted">{task.progress != null ? `${Math.round(task.progress * 100)} %` : ""}</span>
          </div>
          <Progress value={task.progress} tone={failed ? "danger" : "accent"} />
          <div className="selectable min-h-5 break-words text-[12px] text-dim">{failed ? task.error : task.message}</div>
        </>
      )}
      {done && (
        <div className="flex items-center gap-3 rounded-card bg-ok/[.08] px-4 py-3">
          <CheckCircle2 size={18} className="shrink-0 text-ok" />
          <div className="min-w-0">
            <div className="text-[13px] text-text">{t("export.done")}</div>
            <div className="selectable truncate text-caption text-dim">{dest}</div>
          </div>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 text-meta text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="selectable break-words">{error}</span>
        </div>
      )}
    </div>
  );
}
