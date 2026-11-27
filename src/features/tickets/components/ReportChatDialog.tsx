import { useState } from "react";
import { Flag } from "lucide-react";
import { api } from "@/lib/api";
import type { ReportReason } from "@/lib/vibe-sdk";
import { Button, Dialog, Field, Select, Textarea, toast } from "@/components/ui";
import { useLang, useT } from "@/i18n";
import { conflictTicket, ticketCall, ticketErrorText } from "../call";
import { loadLocal, openTicket, refreshTickets } from "../store";

const REASONS: ReportReason[] = ["harassment", "spam", "cheating", "inappropriate", "impersonation", "malware", "other"];
const DETAILS_MAX = 1000;

export function ReportChatDialog({ chatId, messageIds, onClose }: { chatId: string; messageIds: string[]; onClose: () => void }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = details.trim().length;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await ticketCall(() => api.ticketReportChat({ chat_id: chatId, message_ids: messageIds, reason, details: details.trim() || null, locale: lang }));
      toast.success(t("tk.report.sent", { ticket: r.ticket }), t("tk.report.sent_text"), { label: t("tk.open"), onClick: () => openTicket(r.ticket) });
      void loadLocal().then(() => refreshTickets(true));
      onClose();
    } catch (e) {
      const existing = conflictTicket(e);
      if (existing) {
        toast.info(t("tk.report.exists", { ticket: existing }), undefined, { label: t("tk.open"), onClick: () => openTicket(existing) });
        onClose();
        return;
      }
      setError(ticketErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      locked={busy}
      title={
        <span className="flex items-center gap-2">
          <Flag size={17} className="text-danger" />
          {messageIds.length ? t("tk.report.title_msg") : t("tk.report.title_chat")}
        </span>
      }
      description={messageIds.length ? t("tk.report.desc_msg", { n: messageIds.length }) : t("tk.report.desc_chat")}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} disabled={n > DETAILS_MAX} onClick={send} data-testid="report-send">
            {t("tk.report.send")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-1">
        <div className="flex flex-col gap-1.5">
          <span className="label">{t("tk.report.reason")}</span>
          <Select value={reason} onChange={(v) => setReason(v as ReportReason)} options={REASONS.map((r) => ({ value: r, label: t(`tk.reason.${r}`) }))} />
        </div>
        <Field label={t("tk.report.details")} hint={<span className={n > DETAILS_MAX ? "text-danger" : undefined}>{`${n} / ${DETAILS_MAX}`}</span>}>
          <Textarea value={details} maxLength={DETAILS_MAX + 100} onChange={(e) => setDetails(e.target.value)} placeholder={t("tk.report.details_ph")} className="min-h-20" />
        </Field>
        <p className="text-[12px] text-dim">{t("tk.report.privacy")}</p>
        {error && <div className="selectable rounded-card bg-danger/[.08] px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
      </div>
    </Dialog>
  );
}
