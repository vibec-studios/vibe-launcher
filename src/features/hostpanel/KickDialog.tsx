import { useState } from "react";
import { Ban, DoorOpen } from "lucide-react";
import { Button, ChoiceCard, ChoiceGrid, Dialog, Field, Input, toast } from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { requireClient } from "@/features/social/service";
import { useT } from "@/i18n";
import { hostError, panelAction } from "./api";

export function KickDialog({ sessionId, player, onClose }: { sessionId: string; player: { uuid: string | null; name: string }; onClose: () => void }) {
  const t = useT();
  const [permanent, setPermanent] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await panelAction(sessionId, () =>
        requireClient().hosting.kick(sessionId, { player: player.uuid ?? player.name, reason: reason.trim() || undefined, permanent }),
      );
      toast.success(permanent ? t("hpanel.kick.done_ban", { name: player.name }) : t("hpanel.kick.done", { name: player.name }));
      onClose();
    } catch (e) {
      toast.error(hostError(e));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={t("hpanel.kick.title", { name: player.name })}
      description={t("hpanel.kick.desc")}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void submit()} icon={permanent ? <Ban size={14} /> : <DoorOpen size={14} />}>
            {permanent ? t("hpanel.kick.confirm_ban") : t("hpanel.kick.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <PlayerHead uuid={player.uuid ?? ""} name={player.name} size={36} />
          <span className="text-[15px] font-semibold text-text">{player.name}</span>
        </div>
        <ChoiceGrid>
          <ChoiceCard icon={<DoorOpen size={18} />} title={t("hpanel.kick.round")} text={t("hpanel.kick.round_text")} selected={!permanent} onClick={() => setPermanent(false)} />
          <ChoiceCard icon={<Ban size={18} />} title={t("hpanel.kick.ban")} text={t("hpanel.kick.ban_text")} selected={permanent} onClick={() => setPermanent(true)} />
        </ChoiceGrid>
        <Field label={t("hpanel.kick.reason")} hint={t("hpanel.kick.reason_hint")}>
          <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={t("hpanel.kick.reason_ph")} />
        </Field>
      </div>
    </Dialog>
  );
}
