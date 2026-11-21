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
import { useInstanceRuns } from "@/lib/gameStore";
import { isActive } from "@/lib/sessions";
import { SessionMenuTrigger } from "./SessionMenu";
import { PrelaunchSkip, prelaunchLabel } from "./PrelaunchStep";
import { AfkSplitTrigger, useAfkEnabled } from "@/features/afk/AfkMenu";

export const PlayButton = memo(function PlayButton({
  instance,
  size = "md",
  subtle,
  className,
}: {
  instance: Instance;
  size?: "lg" | "md" | "icon";
  /** Zurückhaltend (grau), Akzent erst beim Hover über der umgebenden `group` */
  subtle?: boolean;
  className?: string;
}) {
  const t = useT();
  const { launch } = useInstanceActions();
  const { phase, task } = useRunPhase(instance.id);
  const runs = useInstanceRuns(instance.id);
  const activeCount = runs.filter(isActive).length;
  const afk = useAfkEnabled() && !instance.bedrock;

  if (size === "icon" && phase === "running") {
    const label = activeCount > 1 ? t("sess.stop_all") : t("common.stop");
    return (
      <div className={cn("relative flex shrink-0 items-stretch rounded-ctl bg-black/80", className)}>
        <Tooltip content={label}>
          <button
            aria-label={label}
            onClick={(e) => {
              e.stopPropagation();
              killInstance(instance);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            className="grid h-9 w-9 place-items-center rounded-l-ctl text-danger transition-colors duration-100 hover:bg-danger hover:text-black active:translate-y-px"
          >
            <Square size={13} fill="currentColor" />
          </button>
        </Tooltip>
        <SessionMenuTrigger instance={instance} runs={runs} compact className="h-9 rounded-r-ctl border-l border-white/10 text-muted hover:bg-white/10 hover:text-text" />
        {activeCount > 1 && (
          <span className="pointer-events-none absolute -left-1.5 -top-1.5 min-w-4 rounded-dot bg-danger px-1 text-center text-[10px] font-bold leading-4 text-black">{activeCount}</span>
        )}
      </div>
    );
  }

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
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-ctl transition-[filter,background-color,color] duration-100 active:translate-y-px",
            phase === "running"
              ? "bg-black/80 text-danger hover:bg-danger hover:text-black"
              : phase === "idle"
                ? subtle
                  ? "bg-surface3 text-muted group-hover:bg-accent group-hover:text-[var(--on-accent)]"
                  : "bg-accent text-[var(--on-accent)] hover:brightness-110"
                : "bg-black/80 text-accent",
            className,
          )}
        >
          {phase === "running" ? <Square size={13} fill="currentColor" /> : phase === "idle" ? <Play size={16} fill="currentColor" /> : <Spinner size={13} />}
        </button>
      </Tooltip>
    );
  }

  const h = size === "lg" ? "h-11 min-w-[168px]" : "h-10 min-w-[136px]";

  if (phase === "preparing" || phase === "busy") {
    const p = task?.progress ?? null;
    return (
      <div
        className={cn("relative flex items-stretch overflow-hidden rounded-ctl bg-surface2", h, task?.step === "auto_update" ? "w-[350px]" : size === "lg" ? "w-[240px]" : "w-[220px]", className)}
      >
        <div
          className="absolute inset-y-0 left-0 bg-accent/20 transition-[width] duration-150 ease-linear"
          style={{ width: p === null ? "100%" : `${Math.round(p * 100)}%`, opacity: p === null ? 0.5 : 1 }}
        />
        <div className="relative flex min-w-0 flex-1 items-center gap-2.5 px-3">
          <Spinner size={13} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
              <span className="truncate">{prelaunchLabel(task, t) ?? (phase === "preparing" && !task ? t("inst.starting") : t("inst.preparing"))}</span>
              {p !== null && <span className="tabular-nums text-accent">{Math.round(p * 100)}%</span>}
            </div>
            {task?.message && <div className="truncate text-[11px] text-muted">{task.message}</div>}
          </div>
        </div>
        <PrelaunchSkip task={task} />
        {task && (
          <Tooltip content={t("common.cancel")}>
            <button
              aria-label={t("common.cancel")}
              className="relative grid w-9 shrink-0 place-items-center text-muted transition-colors hover:bg-white/5 hover:text-text"
              onClick={() => api.taskCancel(task.id).catch((e) => toast.error(e))}
            >
              <X size={15} />
            </button>
          </Tooltip>
        )}
      </div>
    );
  }

  if (phase === "running") {
    return (
      <div className="flex items-stretch">
        <Button
          variant="danger"
          size={size === "lg" ? "lg" : "md"}
          className={cn(h, "rounded-r-none", className)}
          icon={<Square size={12} fill="currentColor" />}
          onClick={() => killInstance(instance)}
        >
          {activeCount > 1 ? `${t("common.stop")} (${activeCount})` : t("common.stop")}
        </Button>
        <SessionMenuTrigger
          instance={instance}
          runs={runs}
          className="rounded-r-ctl border-l border-danger/25 bg-danger/12 text-danger hover:bg-danger hover:text-black"
        />
      </div>
    );
  }

  const play = (
    <Button
      variant="accent"
      size={size === "lg" ? "lg" : "md"}
      className={cn(h, afk && "rounded-r-none", className)}
      icon={<Play size={15} fill="currentColor" />}
      onClick={() => launch(instance)}
    >
      {t("common.play")}
    </Button>
  );
  if (!afk) return play;
  return (
    <div className="flex items-stretch">
      {play}
      <AfkSplitTrigger instance={instance} />
    </div>
  );
});
