import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useQuery } from "@tanstack/react-query";
import { FileArchive, Package, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, ErrorState, IconButton, Skeleton, toast } from "@/components/ui";
import { useRunPhase } from "@/components/instance/status";
import { Term } from "@/features/help/glossary/Term";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { World } from "@/lib/types";

interface WorldPacks {
  installed: string[];
  available: string[];
}

export function WorldDatapacksDialog({ instanceId, world, onClose }: { instanceId: string; world: World; onClose: () => void }) {
  const t = useT();
  const { phase } = useRunPhase(instanceId);
  const args = { instanceId, world: world.folder };
  const q = useQuery({
    queryKey: ["content", instanceId, "world-datapacks", world.folder],
    queryFn: () => invoke<WorldPacks>("world_datapacks_list", args),
  });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const gameOpen = phase === "running" || phase === "preparing";
  const canEdit = !busy && !gameOpen;
  const change = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast.error(e);
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
      setBusy(false);
    }
  };
  const add = () => change(async () => {
    const path = await open({ title: t("dp.world.add"), filters: [{ name: t("dp.world.zip"), extensions: ["zip"] }] });
    if (typeof path === "string") await invoke("world_datapacks_add", { ...args, path });
  });
  const remove = () => change(async () => {
    await invoke("world_datapacks_remove", { ...args, file: removing });
    setRemoving(null);
  });

  return (
    <Dialog
      open
      onOpenChange={(value) => { if (!value) onClose(); }}
      locked={busy}
      title={t("dp.world.title", { world: world.name })}
      description={<><Term id="datapack">{t("dp.packs")}</Term> {t("dp.world.text")}</>}
      footer={
        <>
          <Button variant="subtle" disabled={busy} onClick={onClose}>{t("common.close")}</Button>
          <Button variant="primary" disabled={!canEdit} icon={<FileArchive size={15} />} onClick={add}>{t("dp.world.add")}</Button>
        </>
      }
    >
      {gameOpen && <p className="mb-3 text-[13px] text-warn">{t("dp.world.quit")}</p>}
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-20" /> : (
        <div className="flex flex-col gap-4">
          <section className="space-y-1">
            <h3 className="label">{t("dp.world.installed")}</h3>
            {!q.data.installed.length && <p className="text-[13px] text-muted">{t("dp.world.empty")}</p>}
            {q.data.installed.map((file) => (
              <div key={file} className="flex min-h-9 items-center gap-2 rounded-ctl bg-surface px-3 text-[13px]">
                <Package size={15} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 break-all">{file}</span>
                {removing === file ? (
                  <>
                    <Button size="sm" variant="subtle" disabled={busy} onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
                    <Button size="sm" variant="danger" disabled={!canEdit} onClick={remove}>{t("common.delete")}</Button>
                  </>
                ) : (
                  <IconButton size="sm" variant="ghost" label={t("dp.world.remove", { file })} tip disabled={!canEdit} onClick={() => setRemoving(file)}><Trash2 size={14} /></IconButton>
                )}
              </div>
            ))}
          </section>
          {q.data.available.length > 0 && (
            <section className="space-y-1">
              <h3 className="label">{t("dp.world.available")}</h3>
              {q.data.available.map((file) => (
                <div key={file} className="flex min-h-9 items-center gap-2 rounded-ctl px-3 text-[13px] hover:bg-surface">
                  <span className="min-w-0 flex-1 break-all">{file}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Plus size={14} />}
                    disabled={!canEdit}
                    onClick={() => change(() => api.datapacksCopyToWorlds(instanceId, [file], [world.folder]))}
                  >
                    {t("dp.world.copy")}
                  </Button>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}
