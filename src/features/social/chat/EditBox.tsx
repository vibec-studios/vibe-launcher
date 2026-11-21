import { useState } from "react";
import { Spinner, Textarea, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { Message } from "@/lib/vibe-sdk";
import { errText, requireClient } from "../service";

export function EditBox({ m, done }: { m: Message; done: () => void }) {
  const t = useT();
  const [text, setText] = useState(m.content);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = text.trim();
    if (!v || v === m.content) return done();
    setBusy(true);
    try {
      await requireClient().chats.edit(m.chatId, m.id, v);
      done();
    } catch (e) {
      toast.error(errText(e));
      setBusy(false);
    }
  };
  return (
    <div className="w-full">
      <Textarea
        autoFocus
        value={text}
        rows={Math.min(6, text.split("\n").length)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") done();
        }}
        className="text-[13px]"
      />
      <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-dim">
        {busy && <Spinner size={10} />}
        {t("social.msg.edit_hint")}
      </div>
    </div>
  );
}
