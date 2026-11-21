import { CheckCircle2, XCircle } from "lucide-react";
import { useTask } from "@/app/agent";
import { useT } from "@/i18n";
import { Progress } from "./ui";

export function TaskProgress({ taskId, label }: { taskId: string | null; label?: string }) {
  const t = useT();
  const task = useTask(taskId);
  if (!taskId) return null;
  const status = task?.status ?? "running";
  return (
    <div className="flex flex-col gap-2 rounded-card bg-surface2 p-4">
      <div className="flex items-center gap-2 text-[13.5px]">
        {status === "done" && <CheckCircle2 size={17} className="text-ok" />}
        {(status === "failed" || status === "cancelled") && <XCircle size={17} className="text-danger" />}
        <span className="min-w-0 flex-1 truncate font-medium">{task?.title ?? label ?? t("task.running")}</span>
        <span className="text-meta text-muted tabular-nums">{status === "running" ? (task?.progress != null ? `${Math.round(task.progress * 100)} %` : "") : t(`task.${status}`)}</span>
      </div>
      {status === "running" && <Progress value={task?.progress ?? null} />}
      {task?.error && <div className="text-meta text-danger">{task.error}</div>}
      {status === "running" && task?.message && <div className="text-meta text-dim">{task.message}</div>}
    </div>
  );
}
