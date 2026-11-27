import { useEffect, useState } from "react";
import { Paperclip, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { TicketDetail, TicketReplyPreview } from "@/lib/types";
import { Button, Dialog, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { LogBlock } from "@/features/feedback/components/LogBlock";
import { asTicketError, ticketCall, ticketErrorText } from "../call";
import { afterPost } from "../useTicketDetail";
import { AttachSelect, type AttachState } from "./AttachSelect";

export interface AttachPreset {
  logs?: AttachState["logs"];
  fulfills?: string[];
}

const empty = (p: AttachPreset): AttachState => ({ instanceId: null, logs: p.logs ?? [], shots: [], body: "", fulfills: p.fulfills ?? [] });

export function AttachDialog({ d, preset, onClose }: { d: TicketDetail; preset: AttachPreset | null; onClose: () => void }) {
  const t = useT();
  const [s, setS] = useState<AttachState>(() => empty(preset ?? {}));
  const [preview, setPreview] = useState<TicketReplyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = preset !== null;

  useEffect(() => {
    if (preset) {
      setS(empty(preset));
      setPreview(null);
      setError(null);
    }
  }, [preset]);

  const set = (p: Partial<AttachState>) => setS((cur) => ({ ...cur, ...p }));
  const requests = d.requests.filter((r) => r.status === "open" && r.type !== "text");
  const close = (sent: boolean) => {
    if (!sent && s.shots.length) void api.feedbackDiscard(s.shots.map((x) => x.id)).catch(() => {});
    onClose();
  };
  const canNext = s.logs.length > 0 || s.shots.length > 0 || s.body.trim().length > 0;

  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      const fulfills = s.fulfills.filter((id) => requests.some((r) => r.id === id));
      setPreview(await api.ticketReplyPreview({ ticket: d.ticket, body: s.body, fulfills, instance_id: s.instanceId, logs: s.logs, screenshots: s.shots.map((x) => x.id) }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async (p: TicketReplyPreview) => {
    setBusy(true);
    setError(null);
    try {
      const r = await ticketCall(() => api.ticketReplySend(p.token));
      afterPost(d.ticket, r);
      toast.success(t("tk.att.sent"));
      close(true);
    } catch (e) {
      if (asTicketError(e)?.code === "preview_expired") setPreview(null);
      setError(ticketErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close(false)}
      locked={busy}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Paperclip size={17} className="text-brand" />
          {preview ? t("tk.att.preview", { ticket: d.ticket }) : t("tk.att.title", { ticket: d.ticket })}
        </span>
      }
      description={preview ? t("tk.att.preview_desc") : t("tk.att.desc")}
      footer={
        preview ? (
          <>
            <Button variant="subtle" disabled={busy} onClick={() => setPreview(null)}>
              {t("fb.back")}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => send(preview)} data-testid="ticket-attach-send">
              {t("fb.send")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="subtle" onClick={() => close(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!canNext} loading={busy} onClick={next} data-testid="ticket-attach-next">
              {t("fb.next")}
            </Button>
          </>
        )
      }
    >
      {error && <div className="selectable mb-3 rounded-card bg-danger/[.08] px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
      {preview ? (
        <div className="flex flex-col gap-3 pb-1">
          {preview.body && <p className="selectable whitespace-pre-wrap rounded-card bg-surface/60 px-3.5 py-2.5 text-[13px] text-text">{preview.body}</p>}
          {preview.logs.map((l, i) => (
            <LogBlock key={l.name} l={l} initiallyOpen={i === 0} />
          ))}
          {preview.screenshots.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {preview.screenshots.map((x) => (
                <img key={x.id} src={x.thumb} alt={x.name} title={x.name} className="h-24 rounded-xs object-cover shadow-e1" />
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 text-[12px] text-dim">
            <ShieldCheck size={14} />
            <span className="flex-1">{t("tk.att.target")}</span>
            <span className="tabular-nums">{t("fb.preview.total", { size: formatBytes(preview.total_bytes) })}</span>
          </div>
        </div>
      ) : (
        <AttachSelect s={s} set={set} requests={requests} />
      )}
    </Dialog>
  );
}
