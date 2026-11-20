import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, FolderInput, FolderOpen, HardDrive } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Progress, SettingRow, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { useTask } from "@/lib/queries";

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, multiple: false });
  return typeof r === "string" ? r : null;
}

function Path({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-ctl bg-surface2 px-3 py-2">
      <div className="text-meta text-dim">{label}</div>
      <div className="selectable break-all font-mono text-[11.5px] text-text">{value}</div>
    </div>
  );
}

function MoveDialog({ target, onClose }: { target: string; onClose: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["datadir-preview", target], queryFn: () => api.datadirPreview(target), staleTime: 0 });
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useTask(taskId);
  const p = q.data;
  const running = task?.status === "running";
  const blocked = !p || p.locked || !!p.problem || p.busy.length > 0 || !p.enough;
  const start = async () => {
    try {
      setTaskId(await api.datadirMove(target));
    } catch (e) {
      toast.error(e, t("datadir.failed"));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !running && onClose()}
      title={t("datadir.title")}
      description={t("datadir.text")}
      size="md"
      locked={running}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={running}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<FolderInput size={14} />} loading={running} disabled={blocked || running || task?.status === "done"} onClick={start}>
            {t("datadir.move")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 px-6 pb-2">
        {p && (
          <>
            <div className="flex items-center gap-2">
              <Path label={t("datadir.from")} value={p.current} />
              <ArrowRight size={16} className="shrink-0 text-dim" />
              <Path label={t("datadir.to")} value={target} />
            </div>
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <HardDrive size={14} className="shrink-0" />
              {p.free !== null ? t("datadir.space", { size: gb(p.size), free: gb(p.free) }) : t("datadir.size", { size: gb(p.size) })}
            </div>
            {p.problem && <Warn text={p.problem} />}
            {!p.enough && <Warn text={t("datadir.not_enough")} />}
            {p.busy.length > 0 && <Warn text={`${t("datadir.busy")} ${p.busy.join(", ")}`} />}
            {p.locked && <Warn text={t("datadir.locked")} />}
            {p.bedrock_warning && <Warn text={t("datadir.bedrock")} soft />}
            <p className="text-meta text-dim">{t("datadir.safe")}</p>
          </>
        )}
        {task && (task.status === "running" || task.status === "failed") && (
          <div className="flex flex-col gap-1.5">
            {running && <Progress value={task.progress} />}
            <div className={task.status === "failed" ? "text-meta text-danger" : "text-meta text-muted"}>{task.status === "failed" ? task.error : task.message}</div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Warn({ text, soft }: { text: string; soft?: boolean }) {
  return (
    <div className={soft ? "flex gap-2 rounded-card bg-warn/[.07] px-3 py-2 text-[12.5px] text-muted" : "flex gap-2 rounded-card bg-danger/[.08] px-3 py-2 text-[12.5px] text-text"}>
      <AlertTriangle size={14} className={soft ? "mt-px shrink-0 text-warn" : "mt-px shrink-0 text-danger"} />
      <span>{text}</span>
    </div>
  );
}

export function DataDirRow({ dataDir }: { dataDir: string | undefined }) {
  const t = useT();
  const [target, setTarget] = useState<string | null>(null);
  const pv = useQuery({ queryKey: ["datadir-preview", null], queryFn: () => api.datadirPreview(null), staleTime: 60_000 });
  const choose = async () => {
    try {
      const dir = await pickFolder();
      if (dir) setTarget(dir);
    } catch (e) {
      toast.error(e);
    }
  };
  const atDefault = !pv.data || pv.data.current === pv.data.default;
  return (
    <>
      <SettingRow title={t("settings.data_dir")} description={<span className="selectable break-all font-mono text-[11px]">{dataDir ?? "…"}</span>}>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => api.openDataDir().catch((e) => toast.error(e))}>
            {t("common.open_folder")}
          </Button>
          {!pv.data?.locked && (
            <Button size="sm" icon={<FolderInput size={13} />} onClick={choose}>
              {t("datadir.change")}
            </Button>
          )}
        </div>
      </SettingRow>
      {!atDefault && pv.data && !pv.data.locked && (
        <SettingRow title={t("datadir.default")} description={<span className="selectable break-all font-mono text-[11px]">{pv.data.default}</span>}>
          <Button size="sm" onClick={() => setTarget(pv.data!.default)}>
            {t("datadir.back")}
          </Button>
        </SettingRow>
      )}
      {target && <MoveDialog target={target} onClose={() => setTarget(null)} />}
    </>
  );
}
