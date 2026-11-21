import { useState } from "react";
import { ClipboardPaste, FileUp } from "lucide-react";
import { api } from "@/lib/api";
import { FILE_EXT, ThemeImportError, parseThemeInput } from "@/lib/customThemes";
import type { ThemeValues } from "@/lib/types";
import { Button, Dialog, Textarea, toast } from "@/components/ui";
import { useT } from "@/i18n";

export function ImportThemeDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImport: (name: string, values: ThemeValues) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = (o: boolean) => {
    if (!o) {
      setText("");
      setError(null);
    }
    onOpenChange(o);
  };
  const submit = (input = text) => {
    try {
      const r = parseThemeInput(input, t("ct.imported_name"));
      onImport(r.name, r.values);
      close(false);
    } catch (e) {
      setError(t(`ct.err.${e instanceof ThemeImportError ? e.code : "format"}`));
    }
  };
  const fromFile = async () => {
    const { open: pick } = await import("@tauri-apps/plugin-dialog");
    const file = await pick({ multiple: false, directory: false, filters: [{ name: t("ct.file_filter"), extensions: [FILE_EXT, "json"] }] });
    if (typeof file !== "string") return;
    try {
      const content = await api.appearanceThemeRead(file);
      setText(content);
      submit(content);
    } catch (e) {
      toast.error(e, t("ct.err.read"));
    }
  };
  const paste = async () => {
    try {
      const m = await import("@tauri-apps/plugin-clipboard-manager");
      setText((await m.readText()) ?? "");
    } catch {
      setText((await navigator.clipboard?.readText().catch(() => "")) ?? "");
    }
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t("ct.import.title")}
      description={t("ct.import.desc")}
      size="md"
      footer={
        <>
          <Button variant="subtle" icon={<FileUp size={14} />} onClick={() => void fromFile()} className="mr-auto">
            {t("ct.import.file")}
          </Button>
          <Button variant="ghost" onClick={() => close(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => submit()}>
            {t("ct.import.go")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 pb-2">
        <Textarea
          aria-label={t("ct.import.code")}
          value={text}
          placeholder="VIBE-THEME-1:…"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          className="min-h-28 font-mono text-[12px]"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="subtle" icon={<ClipboardPaste size={13} />} onClick={() => void paste()}>
            {t("ct.import.paste")}
          </Button>
          {error && (
            <span role="alert" className="text-[12.5px] text-danger">
              {error}
            </span>
          )}
        </div>
      </div>
    </Dialog>
  );
}
