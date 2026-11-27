import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import { formatBytes } from "@/lib/format";
import type { FeedbackImage, TicketRequest } from "@/lib/types";
import { Button, Field, Select, Spinner, Textarea, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { CheckRow } from "@/features/feedback/components/CheckRow";
import type { LogKind } from "../logic";


export interface AttachState {
  instanceId: string | null;
  logs: LogKind[];
  shots: FeedbackImage[];
  body: string;
  fulfills: string[];
}

export function AttachSelect({ s, set, requests }: { s: AttachState; set: (p: Partial<AttachState>) => void; requests: TicketRequest[] }) {
  const t = useT();
  const { data: instances = [] } = useInstances();
  const logs = useQuery({ queryKey: ["feedback-logs", s.instanceId], queryFn: () => api.feedbackLogs(s.instanceId), staleTime: 5_000 });
  const [picking, setPicking] = useState(false);
  const toggle = <V,>(list: V[], v: V, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

  const pick = async () => {
    setPicking(true);
    try {
      const r = await api.feedbackPickScreenshots(t("tk.att.pick_title"));
      const room = Math.max(0, 3 - s.shots.length);
      const take = r.images.slice(0, room);
      const drop = r.images.slice(take.length).map((i) => i.id);
      if (drop.length) {
        void api.feedbackDiscard(drop);
        toast.error(t("fb.files.max"));
      }
      for (const e of r.errors) toast.error(e);
      if (take.length) set({ shots: [...s.shots, ...take] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-1">
      <div className="flex flex-col gap-1.5">
        <span className="label">{t("fb.instance")}</span>
        <Select
          value={s.instanceId ?? "__none"}
          onChange={(v) => set({ instanceId: v === "__none" ? null : v })}
          options={[{ value: "__none", label: t("fb.instance.none") }, ...instances.map((i) => ({ value: i.id, label: i.name, hint: i.bedrock ? "Bedrock" : i.mc_version }))]}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="label">{t("tk.att.logs")}</span>
        <div className="flex flex-col divide-y divide-line rounded-card bg-surface/60">
          {logs.isLoading ? (
            <div className="px-3.5 py-3">
              <Spinner size={13} />
            </div>
          ) : logs.data?.length ? (
            logs.data.map((l) => (
              <CheckRow
                key={l.kind}
                checked={s.logs.includes(l.kind)}
                onChange={(v) => set({ logs: toggle(s.logs, l.kind, v) })}
                title={l.name}
                desc={`${t(`tk.att.kind.${l.kind}`)} · ${formatBytes(l.bytes)}`}
              />
            ))
          ) : (
            <p className="px-3.5 py-3 text-[12.5px] text-dim">{t("fb.logs.none")}</p>
          )}
        </div>
        <p className="text-[12px] text-dim">{t("fb.logs.desc")}</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="label">{t("tk.att.shots")}</span>
        <div className="flex flex-wrap items-center gap-2 rounded-card bg-surface/60 px-3.5 py-2.5">
          {s.shots.map((img) => (
            <div key={img.id} className="group relative">
              <img src={img.thumb} alt={img.name} title={`${img.name} · ${formatBytes(img.bytes)}`} className="h-14 rounded-xs object-cover shadow-e1" />
              <button
                aria-label={t("fb.files.remove")}
                onClick={() => {
                  void api.feedbackDiscard([img.id]);
                  set({ shots: s.shots.filter((x) => x.id !== img.id) });
                }}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-pill bg-overlay text-muted shadow-e2 hover:text-text"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<ImagePlus size={13} />} loading={picking} disabled={s.shots.length >= 3} onClick={pick}>
            {t("fb.files.add")}
          </Button>
        </div>
      </div>
      {requests.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="label">{t("tk.att.fulfills")}</span>
          <div className="flex flex-col divide-y divide-line rounded-card bg-surface/60">
            {requests.map((r) => (
              <CheckRow
                key={r.id}
                checked={s.fulfills.includes(r.id)}
                onChange={(v) => set({ fulfills: toggle(s.fulfills, r.id, v) })}
                title={t(`tk.req.title.${r.type}`)}
                desc={r.message ?? t(`tk.req.hint.${r.type}`)}
              />
            ))}
          </div>
        </div>
      )}
      <Field label={t("tk.att.note")}>
        <Textarea value={s.body} maxLength={5200} onChange={(e) => set({ body: e.target.value })} placeholder={t("tk.att.note_ph")} className="min-h-16" />
      </Field>
    </div>
  );
}
