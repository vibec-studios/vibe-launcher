import { useState } from "react";
import { Button, Dialog, Input, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { errText, requireClient } from "../service";

export function RenameDialog({ chatId, name: initial, onClose }: { chatId: string; name: string; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("social.group.rename")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await requireClient().chats.updateGroup(chatId, { name: name.trim() });
                onClose();
              } catch (e) {
                toast.error(errText(e));
                setBusy(false);
              }
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
    </Dialog>
  );
}
