import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, FileArchive, X } from "lucide-react";
import type { ImportFormat } from "@/api/client";
import { useAgent, useServers, useTask } from "@/app/agent";
import { bytes } from "@/app/format";
import { navigate } from "@/app/router";
import { useT } from "@/i18n";
import { Button, Dialog, Field, IconButton, Input, Notice, Progress, Segmented, Select } from "@/components/ui";
import { DropZone } from "@/components/DropZone";
import { TaskProgress } from "@/components/TaskProgress";
import { isActive } from "./meta";

function formatOf(f: File): ImportFormat | null {
  const n = f.name.toLowerCase();
  if (n.endsWith(".mrpack")) return "mrpack";
  if (n.endsWith(".vlpack")) return "vlpack";
  if (n.endsWith(".zip")) return "zip";
  return null;
}

export function ModpackDialog({ open, onClose, serverId }: { open: boolean; onClose: () => void; serverId?: string }) {
  const t = useT();
  const { api, base } = useAgent();
  const servers = useServers();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"new" | "update">(serverId ? "update" : "new");
  const [target, setTarget] = useState(serverId ?? "");
  const [name, setName] = useState("");
  const [progress, setProgress] = useState(0);
  const format = file ? formatOf(file) : null;
  const upload = useMutation({
    mutationFn: () => api.importPack(file!, format!, mode === "new" ? { name: name.trim() || undefined } : { server: target }, setProgress),
  });
  const task = useTask(upload.data?.task_id ?? null);
  const stoppable = (servers.data ?? []).filter((s) => !isActive(s.status));
  const close = () => {
    onClose();
    setTimeout(() => {
      setFile(null);
      setProgress(0);
      upload.reset();
    }, 200);
  };
  const ready = !!file && !!format && (mode === "new" || !!target);
  return (
    <Dialog
      open={open}
      onClose={close}
      size="md"
      title={t("pack.title")}
      desc={t("pack.desc")}
      footer={
        upload.data ? (
          <Button
            variant="primary"
            disabled={task?.status !== "done"}
            icon={<ArrowRight size={16} />}
            onClick={() => {
              navigate(`${base}/servers/${encodeURIComponent(upload.data!.server.id)}`);
              close();
            }}
          >
            {t("create.open")}
          </Button>
        ) : (
          <>
            <Button variant="subtle" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!ready} loading={upload.isPending} onClick={() => upload.mutate()}>
              {t("pack.submit")}
            </Button>
          </>
        )
      }
    >
      {upload.data ? (
        <TaskProgress taskId={upload.data.task_id} />
      ) : (
        <div className="flex flex-col gap-5">
          {!serverId && (
            <Segmented
              value={mode}
              onChange={setMode}
              items={[
                { key: "new", label: t("pack.mode.new") },
                { key: "update", label: t("pack.mode.update") },
              ]}
            />
          )}
          {file ? (
            <div className="flex items-center gap-3 rounded-card bg-surface2 p-4">
              <FileArchive size={22} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{file.name}</div>
                <div className="text-meta text-muted">{bytes(file.size)}</div>
              </div>
              {!upload.isPending && (
                <IconButton label={t("common.remove")} onClick={() => setFile(null)}>
                  <X size={16} />
                </IconButton>
              )}
            </div>
          ) : (
            <DropZone accept=".mrpack,.zip,.vlpack" onFiles={(f) => setFile(f[0])}>
              {t("pack.drop")}
            </DropZone>
          )}
          {file && !format && <Notice tone="danger">{t("pack.bad_format")}</Notice>}
          {upload.isPending && <Progress value={progress} />}
          {mode === "new" ? (
            <Field label={t("create.name")} hint={t("pack.name_hint")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={file?.name.replace(/\.(mrpack|zip|vlpack)$/i, "") ?? t("create.name_ph")} />
            </Field>
          ) : (
            <Field label={t("pack.target")} hint={t("pack.target_hint")}>
              <Select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!!serverId}>
                <option value="">{t("pack.pick")}</option>
                {(serverId ? (servers.data ?? []).filter((s) => s.id === serverId) : stoppable).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Notice tone="info">{t("pack.info")}</Notice>
          {upload.error && <Notice tone="danger">{(upload.error as Error).message}</Notice>}
        </div>
      )}
    </Dialog>
  );
}
