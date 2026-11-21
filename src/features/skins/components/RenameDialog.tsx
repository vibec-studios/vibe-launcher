import { useEffect, useState } from "react";
import { Button, Dialog, Input, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { LibrarySkin } from "@/lib/types";
import { skq } from "../library";

export function RenameDialog({ skin, onClose }: { skin: LibrarySkin | null; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (skin) setName(skin.name);
  }, [skin]);
  const submit = async () => {
    if (!skin || !name.trim()) return;
    setBusy(true);
    try {
      await api.skinLibraryRename(skin.id, name.trim());
      void queryClient.invalidateQueries({ queryKey: skq.library });
      onClose();
    } catch (e) {
      toast.error(e, tt("skins.error.library"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!skin}
      onOpenChange={(o) => !o && onClose()}
      title={t("skins.rename_title")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!name.trim()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input autoFocus value={name} maxLength={48} onChange={(e) => setName(e.target.value)} aria-label={t("skins.name")} />
      </form>
    </Dialog>
  );
}
