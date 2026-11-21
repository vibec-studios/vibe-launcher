import { useNavigate } from "@tanstack/react-router";
import { FileUp } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Field, Input, Textarea, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { invalidateSets, setsApi, type ParsedLine } from "../api";
import { ParsedList, initialSelection } from "./PasteList";

export function ImportSetDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ name: string; lines: ParsedLine[]; description: string | null } | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const show = (r: Awaited<ReturnType<typeof setsApi.importText>>) => {
    setResult({ name: r.name ?? t("import.default_name"), lines: r.lines, description: r.description });
    setSel(initialSelection(r.lines));
  };
  const read = async () => {
    setBusy(true);
    try {
      show(await setsApi.importText(text));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const pickFile = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false, filters: [{ name: t("import.file_filter"), extensions: ["json", "vibeset", "txt"] }] });
      if (typeof path !== "string") return;
      setBusy(true);
      show(await setsApi.importFile(path));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const entries = result.lines.filter((_, i) => sel.has(i)).map((l) => l.entry!);
      const s = await setsApi.create(result.name.trim() || t("import.default_name"), entries, result.description);
      await invalidateSets();
      toast.success(t("import.saved", { name: s.name }));
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
      title={t("import.title")}
      description={result ? undefined : t("import.text")}
      size="lg"
      className="[&_.vl-dialog-foot]:flex-wrap"
      footer={
        result ? (
          <>
            <Button variant="subtle" className="mr-auto" onClick={() => setResult(null)}>
              {t("paste.again")}
            </Button>
            <Button variant="subtle" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!sel.size || !result.name.trim()} loading={busy} onClick={() => void save()}>
              {t("import.save")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="subtle" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!text.trim()} loading={busy} onClick={() => void read()}>
              {t("import.read")}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <Field label={t("sets.name")}>
            <Input value={result.name} maxLength={60} onChange={(e) => setResult({ ...result, name: e.target.value })} />
          </Field>
          <div className="-mx-2">
            <ParsedList lines={result.lines} selected={sel} onToggle={(i) => setSel((s) => (s.has(i) ? (s.delete(i), new Set(s)) : new Set(s).add(i)))} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => void pickFile()}
            className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left text-[15px] font-semibold text-text hover:bg-surface2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <FileUp size={20} className="shrink-0 text-accent" /> {t("import.file")}
          </button>
          <Field label={t("import.paste_label")}>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`${t("import.placeholder")}\n\n${t("paste.placeholder")}`}
              rows={6}
              spellCheck={false}
              className="text-[14px]"
            />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
