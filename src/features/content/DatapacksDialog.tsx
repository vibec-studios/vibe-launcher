import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, ErrorState, Skeleton, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";
import type { DatapackOverview } from "@/lib/types";

export const datapacksKey = (id: string) => ["content", id, "datapacks"] as const;

export function useLoosePacks(instanceId: string, enabled = true) {
  return useQuery({ queryKey: datapacksKey(instanceId), queryFn: () => api.datapacksOverview(instanceId), staleTime: 60_000, enabled });
}

export function unusedPacks(o: DatapackOverview | undefined) {
  return (o?.packs ?? []).filter((p) => p.in_worlds.length === 0);
}

function Pick({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className={cn("flex min-h-11 cursor-pointer flex-wrap items-center gap-3 rounded-ctl border px-3 py-2 text-[14px] text-text hover:bg-surface2", checked ? "border-accent/40 bg-accent/[.08]" : "border-line")} onClick={() => onChange(!checked)}>
      <span onClick={(e) => e.stopPropagation()} className="flex">
        <Checkbox checked={checked} onChange={onChange} label={label} />
      </span>
      <span className="min-w-0 flex-1 break-words">
        {label}
      </span>
      {hint && <span className="text-[13px] text-muted">{hint}</span>}
    </div>
  );
}

function toggle(list: string[], v: string, on: boolean) {
  return on ? [...new Set([...list, v])] : list.filter((x) => x !== v);
}

export function DatapacksDialog({ instanceId, open, onClose }: { instanceId: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const q = useLoosePacks(instanceId, open);
  const [files, setFiles] = useState<string[]>([]);
  const [worlds, setWorlds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !q.data) return;
    setFiles(unusedPacks(q.data).map((p) => p.file_name));
    setWorlds(q.data.worlds.slice(0, 1).map((w) => w.folder));
  }, [open, q.data]);
  const data = q.data;
  const copy = async () => {
    setBusy(true);
    try {
      const n = await api.datapacksCopyToWorlds(instanceId, files, worlds);
      queryClient.invalidateQueries({ queryKey: datapacksKey(instanceId) });
      queryClient.invalidateQueries({ queryKey: qk.worlds(instanceId) });
      toast.success(n > 0 ? t("dp.copied", { n }) : t("dp.copied_none"));
      onClose();
    } catch (e) {
      toast.error(e, t("dp.copy_failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("dp.title")}
      description={t("dp.text")}
      size="xl"
      locked={busy}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!files.length || !worlds.length} onClick={copy}>
            {t("dp.copy")}
          </Button>
        </>
      }
    >
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : data && (
        <div className="grid grid-cols-2 gap-4 pb-2 max-[650px]:grid-cols-1">
          <section className="flex min-w-0 flex-col gap-2 rounded-card bg-surface p-4">
            <h2 className="text-[16px] font-semibold text-text">{t("dp.packs")}</h2>
            {data.packs.length === 0 && <p className="text-[14px] text-muted">{t("dp.no_packs")}</p>}
            {data.packs.map((p) => (
              <Pick
                key={p.file_name}
                label={p.file_name}
                checked={files.includes(p.file_name)}
                onChange={(v) => setFiles((l) => toggle(l, p.file_name, v))}
                hint={p.in_worlds.length ? t("dp.in_worlds", { n: p.in_worlds.length }) : t("dp.in_no_world")}
              />
            ))}
          </section>
          <section className="flex min-w-0 flex-col gap-2 rounded-card bg-surface p-4">
            <h2 className="text-[16px] font-semibold text-text">{t("dp.worlds")}</h2>
            {data.worlds.length === 0 ? (
              <p className="text-[14px] text-muted">{t("dp.no_worlds")}</p>
            ) : (
              data.worlds.map((w) => <Pick key={w.folder} label={w.name} checked={worlds.includes(w.folder)} onChange={(v) => setWorlds((l) => toggle(l, w.folder, v))} />)
            )}
          </section>
          <p className="text-[14px] text-muted min-[651px]:col-span-2">{t("dp.reload_hint")}</p>
        </div>
      )}
    </Dialog>
  );
}
