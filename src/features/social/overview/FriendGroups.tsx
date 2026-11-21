import { UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { Button, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Friend, HostSession } from "@/lib/vibe-sdk";
import { FriendListRow } from "../FriendsList";
import { openPageDialog } from "../PageActions";
import { SealArt } from "./SealArt";

function Group({ title, count, children, tone }: { title: string; count: number; children: ReactNode; tone?: "brand" | "ok" | "dim" }) {
  return (
    <section className="flex flex-col">
      <header className="flex h-8 items-center gap-2 px-3">
        <span className={cn("h-2 w-2 rounded-dot", tone === "brand" ? "bg-brand" : tone === "ok" ? "bg-ok" : "bg-[#4a4a52]")} />
        <h3 className="text-[12.5px] font-semibold text-muted">{title}</h3>
        <span className="text-caption tabular-nums text-dim">{count}</span>
      </header>
      <div className="flex flex-col gap-px">{children}</div>
    </section>
  );
}

export function NoFriends() {
  const t = useT();
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <SealArt size={150} />
      <h2 className="mt-4 text-[18px] font-bold tracking-[-0.01em] text-text">{t("social.empty.title")}</h2>
      <p className="mt-1.5 max-w-[420px] text-[13.5px] leading-relaxed text-muted">{t("social.empty.text")}</p>
      <Button variant="primary" className="mt-5" icon={<UserPlus size={15} />} onClick={() => openPageDialog("add")}>
        {t("social.action.add")}
      </Button>
      <p className="mt-3 text-[12px] text-dim">{t("social.empty.hint")}</p>
    </div>
  );
}

export function FriendGroups({ friends, hosts, q }: { friends: Friend[]; hosts: Record<string, HostSession>; q: string }) {
  const t = useT();
  const list = q ? friends.filter((f) => f.user.name.toLowerCase().includes(q)) : friends;
  const playing = list.filter((f) => f.presence.status !== "offline" && (f.presence.activity?.type === "playing" || f.presence.activity?.type === "hosting"));
  const online = list.filter((f) => f.presence.status !== "offline" && !playing.includes(f));
  const offline = list.filter((f) => f.presence.status === "offline");
  const row = (f: Friend) => <FriendListRow key={f.user.id} friend={f} host={hosts[f.user.id]} />;
  if (q && !list.length) return <p className="px-3 py-6 text-center text-[13px] text-dim">{t("social.friends.no_match", { q })}</p>;
  return (
    <div className="flex flex-col gap-5">
      {playing.length > 0 && (
        <Group title={t("social.friends.playing")} count={playing.length} tone="brand">
          {playing.map(row)}
        </Group>
      )}
      {(online.length > 0 || !q) && (
        <Group title={t("social.friends.online_title")} count={online.length} tone="ok">
          {online.length ? online.map(row) : <p className="px-3 py-2 text-[12.5px] text-dim">{playing.length ? t("social.friends.rest_playing") : t("social.friends.none_online")}</p>}
        </Group>
      )}
      {offline.length > 0 && (
        <Group title={t("social.friends.offline_title")} count={offline.length} tone="dim">
          {offline.map(row)}
        </Group>
      )}
    </div>
  );
}
