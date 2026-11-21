import { useT } from "@/i18n";
import type { Chat, PublicUser } from "@/lib/vibe-sdk";
import { useTypingUsers } from "../hooks";
import { AvatarStack } from "./AvatarStack";

/** „X schreibt …“ mit drei blinkenden Pixeln. */
export function TypingLine({ chat }: { chat: Chat }) {
  const t = useT();
  const ids = useTypingUsers(chat.id);
  const users = ids.map((id) => chat.members.find((m) => m.user.id === id)?.user).filter(Boolean) as PublicUser[];
  return (
    <div className="flex h-6 shrink-0 items-center gap-2 px-5 text-[12px] text-muted">
      {users.length > 0 && (
        <span className="flex items-center gap-2 animate-fade-in">
          <AvatarStack users={users} size={14} />
          <span className="flex items-center gap-[3px]" aria-hidden>
            {[0, 0.3, 0.6].map((d) => (
              <span key={d} className="h-[5px] w-[5px] bg-brand" style={{ animation: `vl-pixel 1.2s ${d}s infinite` }} />
            ))}
          </span>
          {users.length === 1 ? t("social.chat.typing_one", { name: users[0].name }) : t("social.chat.typing_many", { n: users.length })}
        </span>
      )}
    </div>
  );
}
