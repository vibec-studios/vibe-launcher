import { toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { Chat } from "@/lib/vibe-sdk";
import { chatTitle } from "../hooks";
import { errText, sendMessage } from "../service";
import { SealArt } from "../Overview";

/** Leerer Chat: Robbe, kurzer Text und Vorschläge zum Losschreiben. */
export function EmptyChat({ chat, meId }: { chat: Chat; meId: string | undefined }) {
  const t = useT();
  const name = chatTitle(chat, meId);
  const send = (text: string) => sendMessage(chat.id, text).catch((e) => toast.error(errText(e)));
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <SealArt size={120} />
      <h3 className="mt-3 text-[16px] font-bold text-text">{t("social.chat.empty_title", { name })}</h3>
      <p className="mt-1 max-w-[360px] text-[13px] text-muted">{t("social.chat.empty_text")}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {[t("social.chat.quick.hi"), t("social.chat.quick.play"), t("social.chat.quick.wave")].map((q) => (
          <button key={q} onClick={() => void send(q)} className="h-8 rounded-ctl bg-surface2 px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface3">
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
