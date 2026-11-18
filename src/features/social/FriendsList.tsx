// Freundesliste mit Presence, Anfragen, Suche nach Spielernamen, Blockierungen. Rechtsklick-Menü je Freund.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { copyText as writeText } from "@/components/content/util";
import { Ban, Check, ChevronDown, Clipboard, MessageSquare, Send, ShieldOff, UserMinus, UserPlus, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { ContextItem, ContextMenu, ContextSeparator, IconButton, SearchInput, Skeleton, Spinner, Tooltip, cn, confirm, toast } from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { t as tr, useT } from "@/i18n";
import type { Friend, FriendRequest, PublicUser, UserWithRelationship } from "@/lib/vibe-sdk";
import { useFriends } from "./hooks";
import { PresenceDot, usePresenceText } from "./presence";
import { errText, openDm, openSocial, refreshRequests, removeFriendLocal, requireClient, useSocial, vqk } from "./service";
import { openInviteFriends } from "./dialogs";

export function Avatar({ user, size = 32, presence }: { user: Pick<PublicUser, "id" | "name">; size?: number; presence?: Friend["presence"] | null }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <PlayerHead uuid={user.id} name={user.name} size={size} />
      {presence !== undefined && <PresenceDot presence={presence} className="absolute -bottom-0.5 -right-0.5" />}
    </span>
  );
}

async function startDm(userId: string) {
  try {
    const c = await openDm(userId);
    openSocial(c.id);
  } catch (e) {
    toast.error(errText(e));
  }
}

export function FriendMenuItems({ friend }: { friend: Friend }) {
  const t = useT();
  const u = friend.user;
  return (
    <>
      <ContextItem icon={<MessageSquare size={14} />} onSelect={() => startDm(u.id)}>
        {t("social.friend.message")}
      </ContextItem>
      <ContextItem icon={<Send size={14} />} onSelect={() => openInviteFriends({ userIds: [u.id] })}>
        {t("social.friend.invite")}
      </ContextItem>
      <ContextItem icon={<Clipboard size={14} />} onSelect={() => writeText(u.name).then(() => toast.success(t("social.copied")))}>
        {t("social.friend.copy_name")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem
        icon={<UserMinus size={14} />}
        danger
        onSelect={async () => {
          if (!(await confirm({ title: t("social.friend.remove_q", { name: u.name }), confirmLabel: t("social.friend.remove"), danger: true }))) return;
          try {
            await requireClient().friends.remove(u.id);
            removeFriendLocal(u.id);
          } catch (e) {
            toast.error(errText(e));
          }
        }}
      >
        {t("social.friend.remove")}
      </ContextItem>
      <ContextItem icon={<Ban size={14} />} danger onSelect={() => blockUser(u)}>
        {t("social.friend.block")}
      </ContextItem>
    </>
  );
}

export async function blockUser(u: Pick<PublicUser, "id" | "name">) {
  const t = tr;
  if (!(await confirm({ title: t("social.friend.block_q", { name: u.name }), text: t("social.friend.block_text"), confirmLabel: t("social.friend.block"), danger: true }))) return;
  try {
    await requireClient().friends.block(u.id);
    removeFriendLocal(u.id);
    toast.success(t("social.friend.blocked", { name: u.name }));
  } catch (e) {
    toast.error(errText(e));
  }
}

export const FriendRow = memo(function FriendRow({ friend, compact }: { friend: Friend; compact?: boolean }) {
  const ptext = usePresenceText();
  const offline = friend.presence.status === "offline";
  return (
    <ContextMenu content={<FriendMenuItems friend={friend} />}>
      <button
        onClick={() => startDm(friend.user.id)}
        className={cn(
          "group flex w-full items-center gap-2.5 px-3 text-left transition-colors duration-100 hover:bg-white/[.04]",
          compact ? "h-11" : "h-12",
          offline && "opacity-60 hover:opacity-100",
        )}
      >
        <Avatar user={friend.user} size={compact ? 26 : 30} presence={friend.presence} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">{friend.user.name}</span>
          <span className={cn("block truncate text-[11px]", friend.presence.activity?.type === "playing" || friend.presence.activity?.type === "hosting" ? "text-brand" : "text-dim")}>
            {friend.user.statusText && offline ? friend.user.statusText : ptext(friend.presence)}
          </span>
        </span>
        <MessageSquare size={14} className="shrink-0 text-dim opacity-0 transition-opacity duration-100 group-hover:opacity-100" />
      </button>
    </ContextMenu>
  );
});

function GroupLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between px-3 pt-2">
      <span className="eyebrow">{children}</span>
      {right}
    </div>
  );
}

function RequestRow({ r }: { r: FriendRequest }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const user = r.direction === "incoming" ? r.from : r.to;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refreshRequests();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ContextMenu
      content={
        <ContextItem icon={<Ban size={14} />} danger onSelect={() => blockUser(user)}>
          {t("social.friend.block")}
        </ContextItem>
      }
    >
      <div className="flex h-12 items-center gap-2.5 px-3">
        <Avatar user={user} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">{user.name}</span>
          <span className="block truncate text-[11px] text-dim">{r.direction === "incoming" ? t("social.req.incoming") : t("social.req.outgoing")}</span>
        </span>
        {busy ? (
          <Spinner size={12} />
        ) : r.direction === "incoming" ? (
          <>
            <IconButton label={t("social.req.accept")} size="sm" onClick={() => act(() => requireClient().friends.accept(r.id))}>
              <Check size={15} className="text-ok" />
            </IconButton>
            <IconButton label={t("social.req.decline")} size="sm" onClick={() => act(() => requireClient().friends.decline(r.id))}>
              <X size={15} />
            </IconButton>
          </>
        ) : (
          <IconButton label={t("social.req.cancel")} size="sm" onClick={() => act(() => requireClient().friends.cancel(r.id))}>
            <X size={15} />
          </IconButton>
        )}
      </div>
    </ContextMenu>
  );
}

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const h = setTimeout(() => setD(v), ms);
    return () => clearTimeout(h);
  }, [v, ms]);
  return d;
}

function AddFriend() {
  const t = useT();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);
  const qc = useQueryClient();
  const search = useQuery({
    queryKey: vqk.search(dq),
    queryFn: () => requireClient().users.search(dq, 8),
    enabled: dq.length >= 2,
    staleTime: 15_000,
    retry: 0,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const send = async (u: { userId: string } | { name: string }) => {
    const key = "userId" in u ? u.userId : u.name;
    setBusy(key);
    try {
      const r = await requireClient().friends.request(u);
      toast.success(r.status === "accepted" ? t("social.req.now_friends") : t("social.req.sent"));
      await refreshRequests();
      qc.invalidateQueries({ queryKey: ["vibe", "search"] });
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const results = dq.length >= 2 ? (search.data ?? []) : [];
  return (
    <div className="border-b border-line px-3 pb-3 pt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (/^[A-Za-z0-9_]{2,25}$/.test(q.trim())) send({ name: q.trim() });
        }}
      >
        <SearchInput value={q} onChange={setQ} placeholder={t("social.add.placeholder")} aria-label={t("social.add.placeholder")} />
      </form>
      {dq.length >= 2 && (
        <div className="mt-2 border border-line bg-black/30 animate-fade-in">
          {search.isLoading ? (
            <div className="flex flex-col gap-1 p-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : search.isError ? (
            <p className="px-3 py-2 text-[12px] text-danger">{errText(search.error)}</p>
          ) : !results.length ? (
            <p className="px-3 py-2 text-[12px] text-dim">{t("social.add.none")}</p>
          ) : (
            results.map((u) => <SearchResult key={u.id} u={u} busy={busy === u.id} onAdd={() => send({ userId: u.id })} />)
          )}
        </div>
      )}
    </div>
  );
}

function SearchResult({ u, busy, onAdd }: { u: UserWithRelationship; busy: boolean; onAdd: () => void }) {
  const t = useT();
  const label: Record<string, string> = {
    friend: t("social.add.is_friend"),
    outgoing: t("social.add.pending"),
    incoming: t("social.add.incoming"),
    self: t("social.add.self"),
    blocked: t("social.add.blocked"),
    blocked_by: t("social.add.unavailable"),
  };
  const canAdd = u.relationship === "none" || u.relationship === "incoming";
  return (
    <div className="flex h-10 items-center gap-2 px-2">
      <Avatar user={u} size={24} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-white">{u.name}</span>
      {canAdd ? (
        <Tooltip content={u.relationship === "incoming" ? t("social.req.accept") : t("social.add.send")}>
          <IconButton label={t("social.add.send")} size="sm" onClick={onAdd} disabled={busy}>
            {busy ? <Spinner size={12} /> : <UserPlus size={15} className="text-brand" />}
          </IconButton>
        </Tooltip>
      ) : (
        <span className="font-mono text-[10px] uppercase tracking-[.1em] text-dim">{label[u.relationship]}</span>
      )}
    </div>
  );
}

function Blocked() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: vqk.blocked, queryFn: () => requireClient().friends.blocked(), enabled: open, staleTime: 60_000 });
  return (
    <div className="mt-2 border-t border-line">
      <button onClick={() => setOpen(!open)} className="flex h-9 w-full items-center gap-1.5 px-3 text-[12px] text-muted hover:text-white">
        <ChevronDown size={13} className={cn("transition-transform duration-150", !open && "-rotate-90")} />
        {t("social.blocked.title")}
        {q.data && q.data.length > 0 && <span className="text-dim">· {q.data.length}</span>}
      </button>
      {open &&
        (q.isLoading ? (
          <Skeleton className="mx-3 mb-2 h-8" />
        ) : !q.data?.length ? (
          <p className="px-3 pb-3 text-[12px] text-dim">{t("social.blocked.none")}</p>
        ) : (
          q.data.map((u) => (
            <div key={u.id} className="flex h-10 items-center gap-2 px-3">
              <Avatar user={u} size={22} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{u.name}</span>
              <Tooltip content={t("social.blocked.unblock")}>
                <IconButton
                  label={t("social.blocked.unblock")}
                  size="sm"
                  onClick={async () => {
                    try {
                      await requireClient().friends.unblock(u.id);
                      q.refetch();
                    } catch (e) {
                      toast.error(errText(e));
                    }
                  }}
                >
                  <ShieldOff size={14} />
                </IconButton>
              </Tooltip>
            </div>
          ))
        ))}
    </div>
  );
}

/** Kompletter Freunde-Tab (Seite) bzw. kompakte Liste (rechtes Panel). */
export function FriendsTab({ compact }: { compact?: boolean }) {
  const t = useT();
  const friends = useFriends();
  const requests = useSocial((s) => s.requests);
  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");
  const online = friends.filter((f) => f.presence.status !== "offline");
  const offline = friends.filter((f) => f.presence.status === "offline");
  return (
    <div className="scroll min-h-0 flex-1 pb-3">
      {!compact && <AddFriend />}
      {incoming.length > 0 && (
        <>
          <GroupLabel>{t("social.req.title_in", { n: incoming.length })}</GroupLabel>
          {incoming.map((r) => (
            <RequestRow key={r.id} r={r} />
          ))}
        </>
      )}
      {!compact && outgoing.length > 0 && (
        <>
          <GroupLabel>{t("social.req.title_out", { n: outgoing.length })}</GroupLabel>
          {outgoing.map((r) => (
            <RequestRow key={r.id} r={r} />
          ))}
        </>
      )}
      <GroupLabel>{t("social.friends.online", { n: online.length })}</GroupLabel>
      {online.length === 0 && <p className="px-3 py-1.5 text-[12px] text-dim">{friends.length ? t("social.friends.none_online") : t("social.friends.empty")}</p>}
      {online.map((f) => (
        <FriendRow key={f.user.id} friend={f} compact={compact} />
      ))}
      {offline.length > 0 && (
        <>
          <GroupLabel>{t("social.friends.offline", { n: offline.length })}</GroupLabel>
          {offline.map((f) => (
            <FriendRow key={f.user.id} friend={f} compact={compact} />
          ))}
        </>
      )}
      {!compact && <Blocked />}
    </div>
  );
}
