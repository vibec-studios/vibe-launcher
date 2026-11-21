import { ListPlus } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Field, Textarea, toast, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { useT } from "@/i18n";
import { errText, useSocial } from "@/features/social/service";
import { joinWaitlist } from "./actions";
import { BetaWhy } from "./BetaNote";
import { useVibeAccess } from "./store";

const MAX_NOTE = 500;

export function JoinWaitlistButton({
  label,
  size = "sm",
  variant = "primary",
  className,
}: {
  label?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const busy = useVibeAccess((s) => s.busy);
  return (
    <>
      <Button size={size} variant={variant} className={className} icon={<ListPlus size={14} />} loading={busy} onClick={() => setOpen(true)}>
        {label ?? t("access.join")}
      </Button>
      <JoinWaitlistDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function JoinWaitlistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const name = useSocial((s) => s.me?.name ?? s.identity);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await joinWaitlist(note);
      onOpenChange(false);
      setNote("");
      if (useVibeAccess.getState().status === "waitlist") toast.success(t("access.join.done"), t("access.join.done_text"));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("access.join.title")}
      description={name ? t("access.join.lead", { name }) : t("access.join.lead_noname")}
      footer={
        <>
          <Button variant="subtle" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<ListPlus size={14} />} loading={busy} onClick={() => void submit()}>
            {t("access.join")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("access.join.note")} hint={`${note.length}/${MAX_NOTE}`}>
          <Textarea
            value={note}
            rows={3}
            maxLength={MAX_NOTE}
            placeholder={t("access.join.note_ph")}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
          />
        </Field>
        <BetaWhy />
      </div>
    </Dialog>
  );
}
