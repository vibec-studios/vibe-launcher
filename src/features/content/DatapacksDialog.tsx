import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, toast } from "@/components/ui";
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
    <div className="flex min-h-9 items-center gap-3 rounded-ctl px-2 text-[13px] text-text hover:bg-surface2" onClick={() => onChange(!checked)}>
      <span onClick={(e) => e.stopPropagation()} className="flex">
        <Checkbox checked={checked} onChange={onChange} label={label} />
      </span>
      <span className="min-w-0 flex-1 cursor-pointer truncate" title={label}>
        {label}
      </span>
      {hint && <span className="shrink-0 text-meta text-dim">{hint}</span>}
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
      size="md"
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
      {data && (
        <div className="flex flex-col gap-4 px-6 pb-2">
          <section>
            <div className="mb-1 text-meta font-semibold uppercase tracking-[.06em] text-dim">{t("dp.packs")}</div>
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
          <section>
            <div className="mb-1 text-meta font-semibold uppercase tracking-[.06em] text-dim">{t("dp.worlds")}</div>
            {data.worlds.length === 0 ? (
              <p className="px-2 text-[13px] text-muted">{t("dp.no_worlds")}</p>
            ) : (
              data.worlds.map((w) => <Pick key={w.folder} label={w.name} checked={worlds.includes(w.folder)} onChange={(v) => setWorlds((l) => toggle(l, w.folder, v))} />)
            )}
          </section>
          <p className="text-meta text-dim">{t("dp.reload_hint")}</p>
        </div>
      )}
    </Dialog>
  );
}
