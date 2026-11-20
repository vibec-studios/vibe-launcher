import { SkipForward } from "lucide-react";
import { Tooltip, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import type { TaskInfo } from "@/lib/types";

export function PrelaunchSkip({ task }: { task: TaskInfo | undefined }) {
  const t = useT();
  if (task?.step !== "auto_update") return null;
  return (
    <Tooltip content={t("prelaunch.skip_hint")}>
      <button
        aria-label={t("prelaunch.skip")}
        className="relative flex shrink-0 items-center gap-1 px-2.5 text-[12px] font-semibold text-accent transition-colors hover:bg-white/5"
        onClick={() => api.launchSkipStep(task.id).catch((e) => toast.error(e))}
      >
        <SkipForward size={13} />
        {t("prelaunch.skip")}
      </button>
    </Tooltip>
  );
}

export function prelaunchLabel(task: TaskInfo | undefined, t: (k: string) => string): string | null {
  if (task?.step === "auto_update") return t("prelaunch.step.auto_update");
  if (task?.step === "world_backup") return t("prelaunch.step.world_backup");
  return null;
}
