import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, Download, History, Plus, Trash2 } from "lucide-react";
import type { ServerBackup, ServerView } from "@/api/types";
import { useAgent } from "@/app/agent";
import { ago, bytes, dateTime } from "@/app/format";
import { useT } from "@/i18n";
import { Button, Card, Empty, IconButton, Notice, Spinner, toast, useConfirm } from "@/components/ui";
import { TaskProgress } from "@/components/TaskProgress";
import { downloadBlob } from "@/features/servers/actions";
import { isActive } from "@/features/servers/meta";

export function BackupsTab({ server: s }: { server: ServerView }) {
  const t = useT();
  const { api, key, can } = useAgent();
  const confirm = useConfirm();
  const [taskId, setTaskId] = useState<string | null>(null);
  const backups = useQuery({ queryKey: [key, s.id, "backups"], queryFn: () => api.backups(s.id) });
  const manage = can("servers.manage");
  const active = isActive(s.status);
  const create = useMutation({ mutationFn: () => api.createBackup(s.id), onSuccess: (r) => setTaskId(r.task_id), onError: (e) => toast.error(e) });
  const restore = useMutation({ mutationFn: (b: ServerBackup) => api.restoreBackup(s.id, b.name), onSuccess: (r) => setTaskId(r.task_id), onError: (e) => toast.error(e) });
  const remove = useMutation({ mutationFn: (b: ServerBackup) => api.deleteBackup(s.id, b.name), onSuccess: () => (backups.refetch(), toast.ok(t("backups.deleted"))), onError: (e) => toast.error(e) });
  const download = async (b: ServerBackup) => {
    try {
      downloadBlob(await api.downloadBackup(s.id, b.name), b.name);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Card
        title={t("backups.title")}
        desc={t("backups.desc")}
        actions={
          manage && (
            <Button variant="primary" icon={<Plus size={15} />} loading={create.isPending} onClick={() => create.mutate()}>
              {t("backups.create")}
            </Button>
          )
        }
      >
        {taskId && (
          <div className="mb-4">
            <TaskProgress taskId={taskId} />
          </div>
        )}
        {active && manage && <div className="mb-3"><Notice tone="info">{t("backups.running_hint")}</Notice></div>}
        {backups.isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : backups.error ? (
          <Notice tone="danger">{(backups.error as Error).message}</Notice>
        ) : !backups.data?.length ? (
          <Empty icon={<Archive size={30} />} title={t("backups.empty")}>
            {t("backups.empty_desc")}
          </Empty>
        ) : (
          <ul>
            {backups.data.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0">
                <Archive size={18} className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{dateTime(b.created)}</div>
                  <div className="text-meta text-dim">
                    {t("backups.world", { world: b.world })} · {bytes(b.size)} · {ago(b.created)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <IconButton label={t("files.download")} onClick={() => download(b)}>
                    <Download size={16} />
                  </IconButton>
                  {manage && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<History size={14} />}
                        disabled={active}
                        title={active ? t("danger.stop_first") : undefined}
                        onClick={async () => (await confirm.ask({ title: t("backups.restore_confirm"), body: t("backups.restore_desc", { date: dateTime(b.created) }), confirm: t("backups.restore") })) && restore.mutate(b)}
                      >
                        {t("backups.restore")}
                      </Button>
                      <IconButton label={t("common.delete")} tone="danger" onClick={async () => (await confirm.ask({ title: t("backups.delete_confirm"), confirm: t("common.delete"), danger: true })) && remove.mutate(b)}>
                        <Trash2 size={16} />
                      </IconButton>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {confirm.node}
    </div>
  );
}
