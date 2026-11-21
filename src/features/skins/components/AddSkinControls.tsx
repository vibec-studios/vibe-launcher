import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, ImagePlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, IconButton, Input, Spinner, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { addFiles, skq } from "../library";

export function AddFileButton() {
  const t = useT();
  return (
    <Button
      variant="ghost"
      icon={<ImagePlus size={15} />}
      onClick={async () => {
        const sel = await openDialog({ multiple: true, filters: [{ name: "PNG", extensions: ["png"] }] });
        if (sel) await addFiles(Array.isArray(sel) ? sel : [sel]);
      }}
    >
      {t("skins.add_file")}
    </Button>
  );
}

export function ImportByName() {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = useMemo(() => /^[A-Za-z0-9_]{1,16}$/.test(name.trim()), [name]);
  const run = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const s = await api.skinLibraryImportPlayer(name.trim());
      void queryClient.invalidateQueries({ queryKey: skq.library });
      toast.success(tt("skins.imported", { name: s.name }));
      setName("");
    } catch (e) {
      toast.error(e, tt("skins.error.import"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex shrink-0 items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <Input
        className="w-[230px]"
        value={name}
        maxLength={16}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("skins.import_placeholder")}
        aria-label={t("skins.import_player")}
      />
      <IconButton label={t("skins.import")} tip variant="ghost" type="submit" disabled={!valid || busy}>
        {busy ? <Spinner size={13} /> : <Download size={15} />}
      </IconButton>
    </form>
  );
}
