// Aufgaben-Anzeige in der Titelleiste (Downloads, Installationen, Importe) mit Popover-Liste.
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, CheckCircle2, Download, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useTaskStore, useTasks } from "@/lib/queries";
import type { TaskInfo } from "@/lib/types";
import { Progress, Spinner, Tooltip, cn, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";

function TaskRow({ task }: { task: TaskInfo }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5 border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="shrink-0">
          {task.status === "running" ? (
            <Spinner size={12} className="text-accent" />
          ) : task.status === "done" ? (
            <CheckCircle2 size={14} className="text-ok" />
          ) : task.status === "failed" ? (
            <AlertTriangle size={14} className="text-danger" />
          ) : (
            <X size={14} className="text-dim" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{task.title}</span>
        {task.status === "running" && (
          <button className="font-mono text-[10px] uppercase tracking-[.1em] text-dim hover:text-danger" onClick={() => api.taskCancel(task.id)}>
            {t("tasks.cancel")}
          </button>
        )}
      </div>
      {task.status === "running" && <Progress value={task.progress} />}
      <div className={cn("selectable truncate text-[11px]", task.status === "failed" ? "text-danger" : "text-dim")} title={task.error ?? task.message ?? ""}>
        {task.status === "failed"
          ? task.error
          : task.status === "cancelled"
            ? t("tasks.cancelled")
            : task.status === "done"
              ? t("tasks.done")
              : (task.message ?? "")}
        {task.status === "running" && task.progress !== null && <span className="float-right font-mono">{Math.round(task.progress * 100)}%</span>}
      </div>
    </div>
  );
}

export function TaskDock() {
  const t = useT();
  const tasks = useTasks();
  const running = tasks.filter((x) => x.status === "running");
  const known = useRef(new Map<string, string>());

  // Fehlgeschlagene Aufgaben einmalig als Toast melden
  useEffect(() => {
    for (const task of tasks) {
      const prev = known.current.get(task.id);
      if (prev !== task.status) {
        known.current.set(task.id, task.status);
        if (prev === "running" && task.status === "failed") toast.error(task.title, task.error ?? tt("tasks.failed"));
      }
    }
  }, [tasks]);

  const total = running.length ? running.reduce((a, x) => a + (x.progress ?? 0), 0) / running.length : 0;
  const indeterminate = running.length > 0 && running.every((x) => x.progress === null);

  return (
    <Popover.Root>
      <Tooltip content={running.length ? `${running.length} × ${t("tasks.title")}` : t("tasks.title")} side="bottom">
        <Popover.Trigger asChild>
          <button
            aria-label={t("tasks.title")}
            className={cn(
              "relative grid h-8 w-8 place-items-center overflow-hidden rounded-ctl transition-colors duration-150",
              running.length ? "bg-accent/12 text-accent" : "text-muted hover:bg-white/[.06] hover:text-text",
            )}
          >
            {running.length ? <Spinner size={13} /> : <Download size={16} />}
            {running.length > 0 && (
              <span className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-white/10">
                <span
                  className="block h-full bg-accent transition-[width] duration-150"
                  style={{ width: indeterminate ? "100%" : `${Math.round(total * 100)}%`, opacity: indeterminate ? 0.5 : 1 }}
                />
              </span>
            )}
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="glass z-[60] w-[380px] overflow-hidden rounded-card bg-overlay shadow-e2 data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          <div className="flex h-11 items-center justify-between border-b border-line px-4">
            <span className="label">{t("tasks.title")}</span>
            {tasks.some((x) => x.status !== "running") && (
              <button
                className="font-mono text-[10px] uppercase tracking-[.1em] text-dim hover:text-white"
                onClick={() => {
                  api.tasksClear().catch(() => {});
                  useTaskStore.getState().clearFinished();
                }}
              >
                {t("tasks.clear")}
              </button>
            )}
          </div>
          <div className="scroll max-h-[420px]">
            {tasks.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-dim">{t("tasks.empty")}</div>
            ) : (
              tasks
                .slice()
                .reverse()
                .map((task) => <TaskRow key={task.id} task={task} />)
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
