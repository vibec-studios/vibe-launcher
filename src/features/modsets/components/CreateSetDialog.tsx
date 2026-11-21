import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Dialog, Field, Input, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { invalidateSets, setsApi } from "../api";

export function CreateSetDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const s = await setsApi.create(name, [], desc);
      await invalidateSets();
      toast.success(t("sets.created", { name: s.name }));
      onClose();
      nav({ to: "/modsets", search: { set: s.id } });
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("sets.create_title")}
      size="md"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!name.trim()} loading={busy} onClick={() => void submit()}>
            {t("sets.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("sets.name")}>
          <Input autoFocus value={name} maxLength={60} placeholder={t("sets.name_placeholder")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
        </Field>
        <Field label={t("sets.description")}>
          <Input value={desc} maxLength={400} placeholder={t("sets.description_placeholder")} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
        </Field>
      </div>
    </Dialog>
  );
}
