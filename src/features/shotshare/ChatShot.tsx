import { useState } from "react";
import { Flag, ImageOff } from "lucide-react";
import { Button, Dialog, Field, Select, Textarea, cn, toast } from "@/components/ui";
import { Lightbox } from "@/components/ui/Lightbox";
import { useT } from "@/i18n";
import type { ReportReason } from "@/lib/vibe-sdk";
import { requireClient } from "@/features/social/service";
import { parseShotLink, useVibeImage } from "./api";
import { shotErr } from "./ShareShotDialog";

const REASONS: ReportReason[] = ["inappropriate", "harassment", "spam", "impersonation", "other"];

export function ReportShotDialog({ target, onClose }: { target: { id: string; key?: string } | null; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState<ReportReason>("inappropriate");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await requireClient().reportScreenshot(target.id, { reason, details: details.trim() || undefined, key: target.key });
      toast.success(t("shotshare.report.sent"));
      setDetails("");
      onClose();
    } catch (e) {
      toast.error(shotErr(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      size="md"
      locked={busy}
      title={t("shotshare.report.title")}
      description={t("shotshare.report.desc")}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" icon={<Flag size={14} />} loading={busy} onClick={send}>
            {t("shotshare.report.send")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Field label={t("shotshare.report.reason")}>
          <Select<ReportReason> value={reason} onChange={setReason} options={REASONS.map((r) => ({ value: r, label: t(`shotshare.reason.${r}`) }))} />
        </Field>
        <Field label={t("shotshare.report.details")} hint={t("shotshare.report.details_hint")}>
          <Textarea value={details} maxLength={1000} rows={4} onChange={(e) => setDetails(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

export function ChatShot({ content, mine }: { content: string; mine: boolean }) {
  const t = useT();
  const link = parseShotLink(content);
  const q = useVibeImage(link?.url);
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState(false);
  if (!link) return null;
  return (
    <div className={cn("mt-1.5 flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <button
        onClick={() => q.data && setOpen(true)}
        className="relative block h-[180px] w-[320px] max-w-full overflow-hidden rounded-card bg-surface2"
        aria-label={t("shotshare.chat.open")}
      >
        {q.isError ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center text-[12px] text-dim">
            <ImageOff size={18} />
            {t("shotshare.chat.unavailable")}
          </span>
        ) : q.data ? (
          <img src={q.data} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="skeleton absolute inset-0" />
        )}
      </button>
      {!mine && q.data && (
        <button onClick={() => setReport(true)} className="flex items-center gap-1 px-0.5 text-[11px] text-dim transition-colors hover:text-danger">
          <Flag size={11} />
          {t("shotshare.report.short")}
        </button>
      )}
      <Lightbox
        images={q.data ? [{ url: q.data, title: t("shotshare.chat.image") }] : []}
        index={open ? 0 : null}
        onIndexChange={() => {}}
        onClose={() => setOpen(false)}
        labels={{ prev: t("shots.prev"), next: t("shots.next"), close: t("common.close") }}
      />
      <ReportShotDialog target={report ? { id: link.id, key: link.key } : null} onClose={() => setReport(false)} />
    </div>
  );
}
