import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Download } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useTask, waitForTask } from "@/lib/queries";
import type { JavaInstall } from "@/lib/types";
import { Button, Tag, toast } from "@/components/ui";
import { useT } from "@/i18n";

export function JavaDownload({ major, installed }: { major: number; installed: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useTask(taskId);
  const busy = !!taskId && (!task || task.status === "running");
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={busy ? undefined : installed ? <Check size={13} className="text-ok" /> : <Download size={13} />}
      loading={busy}
      disabled={installed && !busy}
      title={installed ? t("settings.java.already") : undefined}
      onClick={async () => {
        try {
          const id = await api.javaInstall(major);
          setTaskId(id);
          await waitForTask(id);
          toast.success(t("settings.java.installed", { major }));
          qc.invalidateQueries({ queryKey: qk.java });
        } catch (e) {
          if ((e as { kind?: string })?.kind !== "cancelled") toast.error(e, t("settings.java.install_failed", { major }));
        } finally {
          setTaskId(null);
        }
      }}
    >
      Java {major}
      {busy && task?.progress != null && <span className="text-accent">{Math.round(task.progress * 100)}%</span>}
    </Button>
  );
}

export function JavaRow({ j }: { j: JavaInstall }) {
  const t = useT();
  return (
    <div className="flex items-center gap-4 rounded-ctl px-2 py-2 transition-colors duration-100 hover:bg-white/[.03]">
      <div className="w-[36px] shrink-0 text-section tabular-nums text-text">{j.major}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] text-text">
          {j.version}
          {j.vendor && <span className="text-muted">· {j.vendor}</span>}
        </div>
        <div className="selectable truncate text-caption text-dim" title={j.path}>
          {j.path}
        </div>
      </div>
      <Tag>{j.arch}</Tag>
      {j.managed && <Tag className="bg-ok/12 text-ok">{t("form.java.managed")}</Tag>}
    </div>
  );
}
