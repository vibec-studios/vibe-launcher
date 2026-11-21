import { useEffect } from "react";
import { Progress } from "@/components/ui";
import { useT } from "@/i18n";
import { useTask } from "@/lib/queries";

export function Running({ taskId, isPack, onDone, onFail }: { taskId: string; isPack: boolean; onDone: (instanceId: string) => void; onFail: (m: string) => void }) {
  const t = useT();
  const task = useTask(taskId);
  const status = task?.status;
  useEffect(() => {
    if (!task) return;
    if (task.status === "done") onDone(task.instance_id ?? "");
    else if (task.status === "failed") onFail(task.error ?? t("install.error_title"));
    else if (task.status === "cancelled") onFail(t("tasks.cancelled"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  return (
    <div className="mt-5 flex flex-col gap-2.5 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <span className="label">{isPack ? t("install.running_pack") : t("install.running")}</span>
        <span className="font-mono text-[11px] text-muted">{task?.progress != null ? `${Math.round(task.progress * 100)} %` : ""}</span>
      </div>
      <Progress value={task?.progress ?? null} />
      <div className="h-5 truncate text-[12px] text-dim">{task?.message ?? t("common.loading")}</div>
    </div>
  );
}
