// OWNER: Content-Agent. Ein-Klick „Performance-Mods installieren“ mit Vorschau.
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Dialog, ErrorState, Skeleton, toast } from "@/components/ui";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatLoader } from "@/lib/format";
import { queryClient, waitForTask } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { SelectBox } from "./ContentRow";

export function PerfButton({ instance }: { instance: Instance }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (instance.loader.kind === "vanilla") return null;
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Gauge size={14} />} onClick={() => setOpen(true)}>
        {t("perf.button")}
      </Button>
      {open && <PerfDialog instance={instance} onClose={() => setOpen(false)} />}
    </>
  );
}

function PerfDialog({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["perf", instance.id, instance.mc_version, instance.loader.kind], queryFn: () => api.perfPreview(instance.id), staleTime: 60_000, retry: 0 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setSel(new Set(q.data.filter((c) => c.recommended).map((c) => c.project_id)));
  }, [q.data]);

  const install = async () => {
    setBusy(true);
    try {
      const id = await api.perfInstall(instance.id, [...sel]);
      toast.info(t("perf.started"));
      onClose();
      waitForTask(id)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["content", instance.id] });
          toast.success(t("perf.done"));
        })
        .catch((e) => toast.error(e));
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("perf.title")}
      description={t("perf.description", { loader: formatLoader({ kind: instance.loader.kind, version: null }), mc: instance.mc_version })}
      size="md"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!sel.size} loading={busy} onClick={() => void install()}>
            {t("perf.install_n", { n: sel.size })}
          </Button>
        </>
      }
    >
      {q.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[52px]" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-8" />
      ) : !q.data?.length ? (
        <div className="py-8 text-center text-[13px] text-muted">{t("perf.none")}</div>
      ) : (
        <div className="flex flex-col">
          {q.data.map((c) => {
            const disabled = c.installed || !c.available;
            const on = sel.has(c.project_id);
            return (
              <div
                key={c.project_id}
                onClick={() => !disabled && setSel((s) => (s.has(c.project_id) ? (s.delete(c.project_id), new Set(s)) : new Set(s).add(c.project_id)))}
                className={`flex items-center gap-3 border-b border-line/60 px-1 py-2.5 ${disabled ? "opacity-55" : "cursor-default hover:bg-white/[.03]"}`}
              >
                {disabled ? <span className="w-[18px]" /> : <SelectBox state={on ? "on" : "off"} label={c.title} onClick={() => {}} />}
                <ProjectIcon src={c.icon_url} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-white">{c.title}</span>
                    {c.version_number && <span className="truncate text-[12px] text-dim">{c.version_number}</span>}
                  </div>
                  <div className="truncate text-[12px] text-muted">{c.note ?? c.description}</div>
                </div>
                {c.installed ? (
                  <span className="shrink-0 text-[12px] text-ok">{t("perf.installed")}</span>
                ) : !c.available ? (
                  <span className="shrink-0 text-[12px] text-dim">{t("perf.unavailable")}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
