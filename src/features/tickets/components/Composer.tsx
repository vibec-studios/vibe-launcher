import { useState, type RefObject } from "react";
import { Lock, Paperclip, Send, X } from "lucide-react";
import { api } from "@/lib/api";
import type { TicketDetail } from "@/lib/types";
import { Button, Textarea, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { ticketCall, ticketErrorText } from "../call";
import { afterPost } from "../useTicketDetail";

export const BODY_MAX = 5000;

export function Composer({
  d,
  fulfills,
  setFulfills,
  onAttach,
  inputRef,
}: {
  d: TicketDetail;
  fulfills: string[];
  setFulfills: (ids: string[]) => void;
  onAttach: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useT();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const n = body.trim().length;
  if (!d.canReply)
    return (
      <div className="flex items-center gap-2 rounded-card bg-surface/60 px-3.5 py-3 text-[12.5px] text-muted">
        <Lock size={14} className="shrink-0" />
        {t("tk.closed")}
      </div>
    );
  const pending = fulfills.map((id) => d.requests.find((r) => r.id === id)).filter((r) => !!r && r.status === "open");
  const send = async () => {
    setBusy(true);
    try {
      const ids = pending.map((r) => r!.id);
      const r = await ticketCall(() => api.ticketReply(d.ticket, body, ids));
      afterPost(d.ticket, r);
      setBody("");
      setFulfills([]);
    } catch (e) {
      toast.error(ticketErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-card bg-surface/60 p-2.5">
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pending.map((r) => (
            <span key={r!.id} className="inline-flex h-6 items-center gap-1 rounded-pill bg-warn/15 pl-2 pr-1 text-[11.5px] font-medium text-warn">
              {t("tk.composer.answers", { what: t(`tk.req.title.${r!.type}`) })}
              <button aria-label={t("common.remove")} onClick={() => setFulfills(fulfills.filter((x) => x !== r!.id))} className="grid h-4 w-4 place-items-center rounded-pill hover:bg-white/10">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <Textarea
        ref={inputRef}
        value={body}
        maxLength={BODY_MAX + 200}
        spellCheck
        data-testid="ticket-reply"
        placeholder={d.status === "done" ? t("tk.composer.ph_done") : t("tk.composer.ph")}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && n > 0 && n <= BODY_MAX && !busy) void send();
        }}
        className="min-h-20 bg-transparent"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" icon={<Paperclip size={13} />} onClick={onAttach} data-testid="ticket-attach">
          {t("tk.composer.attach")}
        </Button>
        <span className="flex-1" />
        <span className={cn("text-[11.5px] tabular-nums text-dim", n > BODY_MAX && "text-danger")}>{n > 0 ? `${n} / ${BODY_MAX}` : t("tk.composer.hint")}</span>
        <Button size="sm" variant="primary" icon={<Send size={13} />} loading={busy} disabled={!n || n > BODY_MAX} onClick={send} data-testid="ticket-send">
          {t("tk.composer.send")}
        </Button>
      </div>
    </div>
  );
}
