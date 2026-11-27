// Feedback-/Fehlerbericht-Dialog: Eingabe → Vorschau (genau das, was gesendet wird) → Danke.
// Rust liest und bereinigt die Logs selbst und hält Screenshots nur im Speicher (commands/feedback.rs).
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Check, MessageSquareWarning, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { FeedbackPreview } from "@/lib/types";
import { Button, Dialog, toast } from "@/components/ui";
import { useLang, useT } from "@/i18n";
import { closeFeedback, resetFeedback, useFeedback } from "./store";
import { loadLocal } from "@/features/tickets/store";
import { DoneStep } from "./components/DoneStep";
import { EditStep } from "./components/EditStep";
import { PreviewStep } from "./components/PreviewStep";
import { useFeedbackAccount } from "./hooks/useFeedbackAccount";
import { CONTACT_MAX, hostOf, MAX, MIN, type Step } from "./utils";

export function FeedbackDialog() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const open = useFeedback((s) => s.open);
  const message = useFeedback((s) => s.message);
  const contact = useFeedback((s) => s.contact);
  const account = useFeedbackAccount();
  const [step, setStep] = useState<Step>({ s: "edit" });
  const [busy, setBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const n = message.trim().length;
  const canNext = n >= MIN && n <= MAX && contact.trim().length <= CONTACT_MAX;

  const next = async () => {
    const f = useFeedback.getState();
    setBusy(true);
    setEditErr(null);
    try {
      const p = await api.feedbackPreview({
        kind: f.kind,
        message: f.message,
        contact: f.contact.trim() || null,
        locale: lang,
        page: path,
        instance_id: f.instanceId,
        attach_logs: f.attachLogs,
        screenshots: [...(f.attachWindow && f.windowShot ? [f.windowShot.id] : []), ...f.files.map((x) => x.id)],
        link_account: !!account && f.linkAccount,
      });
      setStep({ s: "preview", p, error: null });
    } catch (e) {
      setEditErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // Beim Öffnen immer bei der Eingabe beginnen (außer direkt nach „Danke“)
  useEffect(() => {
    if (open) setStep((st) => (st.s === "done" ? { s: "edit" } : st));
  }, [open]);

  const title = step.s === "preview" ? t("fb.preview.title") : step.s === "done" ? t("fb.done.title") : t("fb.title");
  const host = step.s === "preview" ? hostOf(step.p.endpoint) : "vibe.axolite.app";
  const desc = step.s === "preview" ? t("fb.preview.desc", { host }) : step.s === "done" ? undefined : t("fb.desc");

  const send = async (p: FeedbackPreview) => {
    setBusy(true);
    try {
      const r = await api.feedbackSend(p.token);
      if (r.status === "sent") {
        resetFeedback();
        void loadLocal();
        setStep({ s: "done", ticket: r.ticket });
      } else setStep({ s: "preview", p, error: r });
    } catch (e) {
      // Vorschau abgelaufen o. Ä. -> zurück zur Eingabe, Entwurf bleibt
      toast.error(errorMessage(e));
      setStep({ s: "edit" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && closeFeedback()}
      title={
        <span className="flex items-center gap-2">
          {step.s === "done" ? <Check size={18} className="text-ok" /> : <MessageSquareWarning size={18} className="text-brand" />}
          {title}
        </span>
      }
      description={desc}
      size="lg"
      locked={busy}
      footer={
        step.s === "edit" ? (
          <>
            <p className="mr-auto flex min-w-0 flex-1 items-start gap-2 pr-2 text-[12px] text-dim">
              <ShieldCheck size={14} className="mt-px shrink-0" />
              {t("fb.target", { host: "vibe.axolite.app" })}
            </p>
            <Button variant="subtle" onClick={closeFeedback}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!canNext} loading={busy} onClick={next} data-testid="fb-next">
              {t("fb.next")}
            </Button>
          </>
        ) : step.s === "preview" ? (
          <>
            <Button variant="subtle" disabled={busy} onClick={() => setStep({ s: "edit" })}>
              {t("fb.back")}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => send(step.p)} data-testid="fb-send">
              {step.error ? t("fb.retry") : t("fb.send")}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={closeFeedback}>
            {t("common.close")}
          </Button>
        )
      }
    >
      {step.s === "edit" && <EditStep error={editErr} account={account} />}
      {step.s === "preview" && <PreviewStep p={step.p} error={step.error} />}
      {step.s === "done" && <DoneStep ticket={step.ticket} />}
    </Dialog>
  );
}
