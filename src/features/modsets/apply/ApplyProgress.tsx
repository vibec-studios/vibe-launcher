import { AlertTriangle, Check, Download } from "lucide-react";
import { Progress } from "@/components/ui";
import { useT } from "@/i18n";
import type { TaskInfo } from "@/lib/types";

export function ApplyProgress({ task, running }: { task: TaskInfo | undefined; running: boolean }) {
  const t = useT();
  return (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          {task?.status === "done" ? (
            <span className="grid h-12 w-12 place-items-center rounded-pill bg-ok/15 text-ok">
              <Check size={24} />
            </span>
          ) : task?.status === "failed" || task?.status === "cancelled" ? (
            <span className="grid h-12 w-12 place-items-center rounded-pill bg-danger/15 text-danger">
              <AlertTriangle size={22} />
            </span>
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-pill bg-brand/15 text-brand">
              <Download size={22} />
            </span>
          )}
          <div className="text-[15px] font-semibold text-text">
            {task?.status === "done" ? t("apply.done") : task?.status === "failed" ? t("apply.failed") : t("apply.running")}
          </div>
          <div className="max-w-[420px] text-[13px] text-muted">{task?.status === "failed" ? task.error : task?.message}</div>
          {running && <Progress value={task?.progress ?? null} className="w-[360px]" />}
        </div>
  );
}
