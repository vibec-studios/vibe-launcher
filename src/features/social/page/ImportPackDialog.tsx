import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { useT } from "@/i18n";
import { parseInviteCode } from "@/lib/domains";
import { enqueueAppAction } from "@/lib/appActions";
import { openPackImport } from "../dialogStore";
import { closePageDialog as close } from "./store";
import { parsePackCode } from "./utils";

export function ImportPackDialog() {
  const t = useT();
  const [code, setCode] = useState("");
  // Eingefügter Einladungslink (https://axolite.cc/j/…, alt https://vibe.henny.dev/j/…) -> Spiel beitreten
  const join = parseInviteCode(code);
  const c = join ? "" : parsePackCode(code);
  const submit = () => {
    if (join) {
      close();
      enqueueAppAction({ kind: "play_link", code: join });
      return;
    }
    if (!c) return;
    close();
    openPackImport(c);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={t("social.action.import")}
      description={t("social.import.desc")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<ArrowRight size={14} />} disabled={!c && !join} onClick={submit}>
            {t("social.import.next")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t("social.import.label")} hint={join ? t("social.import.detected_join", { code: join }) : c ? t("social.import.detected", { code: c }) : t("social.import.hint")}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("social.pack.code_ph")}
            className="font-mono text-[13px]"
            spellCheck={false}
            autoFocus
          />
        </Field>
      </form>
    </Dialog>
  );
}
