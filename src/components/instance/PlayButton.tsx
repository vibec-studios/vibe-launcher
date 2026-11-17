// Spielen/Stoppen-Knopf mit Live-Zustand. Während der Vorbereitung zeigt er den Fortschritt der laufenden
// Aufgabe direkt im Knopf und lässt sich abbrechen.
import { memo } from "react";
import { Play, Square, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";
import { Button, Spinner, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { killInstance, useInstanceActions } from "./actions";
import { useRunPhase } from "./status";

export const PlayButton = memo(function PlayButton({
  instance,
  size = "lg",
  className,
}: {
  instance: Instance;
  size?: "lg" | "md" | "icon";
  className?: string;
}) {
  const t = useT();
  const { launch } = useInstanceActions();
  const { phase, task } = useRunPhase(instance.id);

  if (size === "icon") {
    const label = phase === "running" ? t("common.stop") : phase === "idle" ? t("common.play") : (task?.message ?? t("inst.preparing"));
    return (
      <Tooltip content={label}>
        <button
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            if (phase === "running") killInstance(instance);
            else if (phase === "idle") launch(instance);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={cn(
            "grid h-10 w-10 place-items-center border transition-[filter,transform,background-color] duration-150 active:translate-y-px",
            phase === "running"
              ? "border-danger/60 bg-black/70 text-danger hover:bg-danger hover:text-black"
              : "border-transparent bg-accent text-[var(--on-accent)] hover:brightness-110",
            className,
          )}
        >
          {phase === "running" ? <Square size={14} fill="currentColor" /> : phase === "idle" ? <Play size={17} fill="currentColor" /> : <Spinner size={14} />}
        </button>
      </Tooltip>
    );
  }

  const h = size === "lg" ? "h-[52px] min-w-[220px]" : "h-10 min-w-[150px]";

  if (phase === "preparing" || phase === "busy") {
    const p = task?.progress ?? null;
    return (
      <div className={cn("relative flex items-stretch overflow-hidden border border-accent/60 bg-black/50", h, className)}>
        <div
          className="absolute inset-y-0 left-0 bg-accent/25 transition-[width] duration-150 ease-linear"
          style={{ width: p === null ? "100%" : `${Math.round(p * 100)}%`, opacity: p === null ? 0.5 : 1 }}
        />
        <div className="relative flex min-w-0 flex-1 items-center gap-3 px-4">
          <Spinner size={size === "lg" ? 15 : 13} className="text-accent" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-mono text-[12px] font-semibold uppercase tracking-[.1em] text-white">
              {phase === "preparing" && !task ? t("inst.starting") : t("inst.preparing")}
              {p !== null && <span className="ml-2 text-accent">{Math.round(p * 100)}%</span>}
            </div>
            {size === "lg" && task?.message && <div className="truncate text-[11px] text-muted">{task.message}</div>}
          </div>
        </div>
        {task && (
          <Tooltip content={t("common.cancel")}>
            <button
              aria-label={t("common.cancel")}
              className="relative grid w-11 shrink-0 place-items-center border-l border-accent/30 text-muted transition-colors hover:bg-white/5 hover:text-white"
              onClick={() => api.taskCancel(task.id).catch((e) => toast.error(e))}
            >
              <X size={16} />
            </button>
          </Tooltip>
        )}
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Button
        variant="danger"
        size={size === "lg" ? "lg" : "md"}
        className={cn(h, className)}
        icon={<Square size={13} fill="currentColor" />}
        onClick={() => killInstance(instance)}
      >
        {t("common.stop")}
      </Button>
    );
  }

  return (
    <Button
      variant="accent"
      size={size === "lg" ? "lg" : "md"}
      className={cn(h, "hover:-translate-y-px", className)}
      icon={<Play size={size === "lg" ? 17 : 15} fill="currentColor" />}
      onClick={() => launch(instance)}
    >
      {t("common.play")}
    </Button>
  );
});
