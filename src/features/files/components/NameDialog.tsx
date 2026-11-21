import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "@/lib/types";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { useT } from "@/i18n";
import { dirName } from "../util";

export type NameDialog = { kind: "file" | "folder"; dir: string } | { kind: "rename"; entry: FileEntry } | null;


export function NameDialogView({ state, onClose, onSubmit }: { state: NameDialog; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const initial = state?.kind === "rename" ? state.entry.name : "";
  useEffect(() => {
    if (!state) return;
    setName(initial);
    setError(null);
    setBusy(false);
    // Beim Umbenennen nur den Namensteil vor der Endung markieren
    const id = setTimeout(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      const dot = state.kind === "rename" && !state.entry.is_dir ? initial.lastIndexOf(".") : -1;
      el.setSelectionRange(0, dot > 0 ? dot : initial.length);
    }, 30);
    return () => clearTimeout(id);
  }, [state, initial]);
  const dir = !state ? "" : state.kind === "rename" ? dirName(state.entry.path) : state.dir;
  const title = !state ? "" : state.kind === "file" ? t("files.new_file.title") : state.kind === "folder" ? t("files.new_folder.title") : t("files.rename.title");
  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(n);
    } catch (e) {
      // „Ungültige Eingabe: …“ aus dem Backend – hier reicht die eigentliche Meldung
      setError(((e as { message?: string })?.message ?? String(e)).replace(/^Ungültige Eingabe: /, ""));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={t("files.in", { path: dir ? `${dir}/` : t("files.root") })}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="accent" loading={busy} disabled={!name.trim() || (state?.kind === "rename" && name.trim() === initial)} onClick={() => void submit()}>
            {state?.kind === "rename" ? t("files.act.rename") : t("files.create")}
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
        <Field label={t("files.name")} error={error}>
          <Input ref={input} value={name} invalid={!!error} onChange={(e) => setName(e.target.value)} placeholder={state?.kind === "folder" ? "neuer-ordner" : "datei.json"} />
        </Field>
      </form>
    </Dialog>
  );
}
