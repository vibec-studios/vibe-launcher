import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { errText, requireClient, sendMessage, sendTyping, vibeClient, vqk } from "../service";
import { EmojiPicker } from "./EmojiPicker";

export function Composer({ chatId, placeholder }: { chatId: string; placeholder: string }) {
  const t = useT();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const meta = useQuery({ queryKey: vqk.meta, queryFn: () => requireClient().meta(), staleTime: 10 * 60_000, enabled: !!vibeClient() });
  const max = meta.data?.limits.chatMessageMaxLength ?? 2000;
  const chatOn = meta.data?.features.chat !== false;
  useEffect(() => {
    setText("");
    ref.current?.focus();
  }, [chatId]);
  const send = () => {
    const v = text.trim();
    if (!v || v.length > max) return;
    setText("");
    sendMessage(chatId, v).catch((e) => {
      toast.error(errText(e));
      setText((cur) => cur || v);
    });
  };
  const insert = (e: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + e + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + e.length, start + e.length);
    });
  };
  const rows = Math.min(6, Math.max(1, text.split("\n").length));
  const can = !!text.trim() && chatOn;
  return (
    <div className="shrink-0 px-5 pb-4">
      <div className="flex items-end gap-1 rounded-card bg-surface2 py-1 pl-1 pr-1 transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--line-2)]">
        <textarea
          ref={ref}
          value={text}
          rows={rows}
          spellCheck={false}
          disabled={!chatOn}
          maxLength={max}
          placeholder={chatOn ? placeholder : t("social.chat.disabled")}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) sendTyping(chatId);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="scroll max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-2.5 py-[9px] text-[13.5px] leading-[1.45] text-text outline-none placeholder:text-dim disabled:opacity-50"
        />
        <EmojiPicker onPick={insert} />
        <IconButton
          label={t("social.chat.send")}
          tip
          tipSide="top"
          variant={can ? "accent" : "ghost"}
          onClick={send}
          disabled={!can}
          className="h-8 w-8 transition-transform active:scale-95"
        >
          <Send size={15} />
        </IconButton>
      </div>
      <div className="flex h-4 items-center justify-between px-1 pt-1 text-[11px] text-dim">
        <span>{text ? t("social.chat.enter_hint") : ""}</span>
        {text.length > max - 200 && (
          <span className="tabular-nums">
            {text.length}/{max}
          </span>
        )}
      </div>
    </div>
  );
}
