// Ein Chat: Kopf mit Skin-Kopf und Aktivität, virtualisierter Verlauf in Nachrichtengruppen (ältere Seiten beim
// Hochscrollen), eigene Blasen in der Akzentfarbe, große Emojis, Einladungs- und Modpack-Karten, Gelesen-Status,
// Tipp-Anzeige, Eingabe mit Emoji-Auswahl.
import { useEffect } from "react";
import { Spinner } from "@/components/ui";
import { useT } from "@/i18n";
import { chatTitle } from "./hooks";
import { markRead, useSocial } from "./service";
import { ChatHeader } from "./chat/ChatHeader";
import { Composer } from "./chat/Composer";
import { Messages } from "./chat/Messages";
import { TypingLine } from "./chat/TypingLine";

export { AvatarStack } from "./chat/AvatarStack";

export function ChatView({ chatId }: { chatId: string }) {
  const t = useT();
  const chat = useSocial((s) => s.chats[chatId]);
  const meId = useSocial((s) => s.me?.id);

  useEffect(() => {
    useSocial.setState({ activeChat: chatId });
    return () => {
      if (useSocial.getState().activeChat === chatId) useSocial.setState({ activeChat: null });
    };
  }, [chatId]);

  const unread = chat?.unreadCount ?? 0;
  useEffect(() => {
    if (unread > 0 && document.hasFocus()) markRead(chatId);
  }, [chatId, unread]);

  if (!chat) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-dim">
        <Spinner size={16} />
      </div>
    );
  }
  return (
    <div className="flex h-full min-w-0 flex-col">
      <ChatHeader chat={chat} meId={meId} />
      <Messages key={chatId} chat={chat} meId={meId} />
      <TypingLine chat={chat} />
      <Composer chatId={chatId} placeholder={t("social.chat.placeholder", { name: chatTitle(chat, meId) })} />
    </div>
  );
}
