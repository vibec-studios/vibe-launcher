import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";
import { useT } from "@/i18n";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { runBackupTask } from "../worldActions";

export function CreateSnapshotDialog({ instance, open, onClose }: { instance: Instance; open: boolean; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const ok = await runBackupTask(() => api.snapshotCreate(instance.id, name.trim() || null), t("backups.snapshot.created"), t("backups.snapshot.create_failed"), name.trim() || undefined);
    setBusy(false);
    if (ok) {
      setName("");
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t("backups.snapshot.create")}
      description={t("backups.snapshot.create_text")}
      size="sm"
      locked={busy}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="accent" icon={<Plus size={14} />} loading={busy} onClick={go}>
            {t("backups.snapshot.create")}
          </Button>
        </>
      }
    >
      <Field label={t("backups.snapshot.name")}>
        <Input
          autoFocus
          value={name}
          maxLength={80}
          placeholder={t("backups.snapshot.name_placeholder")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && go()}
        />
      </Field>
    </Dialog>
  );
}
