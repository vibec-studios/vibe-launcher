import { useState } from "react";
import { Check, MessageSquare, Users } from "lucide-react";
import { Button, Dialog, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { Screenshot } from "@/lib/vibe-sdk";
import { chatTitle, useChatsSorted } from "@/features/social/hooks";
import { sendMessage, useSocial } from "@/features/social/service";
import { setVisibility, shareUrl } from "./api";
import { shotErr } from "./ShareShotDialog";

export function ChatShareDialog({ shot, onClose, onShared }: { shot: Screenshot | null; onClose: () => void; onShared?: (s: Screenshot) => void }) {
  const t = useT();
  const chats = useChatsSorted();
  const meId = useSocial((s) => s.me?.id);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const close = () => {
    setPicked([]);
    onClose();
  };

  const send = async () => {
    if (!shot || !picked.length) return;
    setBusy(true);
    try {
      let s = shot;
      if (s.visibility === "private") {
        s = await setVisibility(s.id, "friends");
        onShared?.(s);
      }
      const url = shareUrl(s);
      if (!url) return;
      for (const id of picked) await sendMessage(id, `${t("shotshare.chat_msg")} ${url}`);
      toast.success(t(picked.length === 1 ? "shotshare.chat_sent_one" : "shotshare.chat_sent", { n: picked.length }));
      close();
    } catch (e) {
      toast.error(shotErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!shot}
      onOpenChange={(o) => !o && close()}
      size="md"
      locked={busy}
      title={t("shotshare.chat.title")}
      description={shot?.visibility === "link" ? t("shotshare.chat.desc_link") : t("shotshare.chat.desc_friends")}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<MessageSquare size={14} />} loading={busy} disabled={!picked.length} onClick={send}>
            {t("shotshare.chat.send")}
          </Button>
        </>
      }
    >
      {chats.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted">{t("shotshare.chat.none")}</p>
      ) : (
        <div className="flex flex-col gap-1 pb-2">
          {chats.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                aria-pressed={on}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-ctl px-3 text-left text-[13.5px] transition-colors",
                  on ? "bg-brand/15 text-text" : "text-muted hover:bg-white/[.05] hover:text-text",
                )}
              >
                {c.type === "group" ? <Users size={16} className="shrink-0 text-dim" /> : <MessageSquare size={16} className="shrink-0 text-dim" />}
                <span className="min-w-0 flex-1 truncate">{chatTitle(c, meId)}</span>
                {on && <Check size={16} className="shrink-0 text-brand" />}
              </button>
            );
          })}
        </div>
      )}
      {shot?.visibility === "private" && <p className="pb-2 text-[12px] text-dim">{t("shotshare.chat.private_note")}</p>}
    </Dialog>
  );
}
