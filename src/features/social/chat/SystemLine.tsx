import { useT } from "@/i18n";
import type { Message } from "@/lib/vibe-sdk";
import { useSocial } from "../service";
import { timeOf } from "./utils";

export function SystemLine({ m }: { m: Message }) {
  const t = useT();
  const chats = useSocial((s) => s.chats);
  const members = chats[m.chatId]?.members ?? [];
  const name = (id: string | null | undefined) => members.find((x) => x.user.id === id)?.user.name ?? t("social.msg.someone");
  const s = m.system;
  const text = !s ? m.content : t(`social.sys.${s.event}`, { actor: name(s.actorId), target: name(s.targetId), name: s.name ?? "" });
  return (
    <div className="flex justify-center px-5 py-2.5">
      <span className="rounded-pill bg-white/[.04] px-3 py-1 text-[11.5px] text-dim">
        {text} · {timeOf(m.createdAt)}
      </span>
    </div>
  );
}
