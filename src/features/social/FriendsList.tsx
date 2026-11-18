// Freunde: Avatar mit Status, kompakte Zeilen für die Freunde-Seite (eine sichtbare Aktion, Rest im ⋯-/Kontextmenü), das Panel,
// Anfragen, Suche nach Spielernamen (für „Freund hinzufügen“) und Blockierungen.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { copyText as writeText } from "@/components/content/util";
import { Ban, Check, Clipboard, Ellipsis, MessageSquare, Play, Send, ShieldOff, UserMinus, UserPlus, X } from "lucide-react";
import { Fragment, memo, useEffect, useState, type ReactNode } from "react";
import {
  Button,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  IconButton,
  SearchInput,
  Skeleton,
  Spinner,
  cn,
  confirm,
  toast,
} from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { t as tr, useT } from "@/i18n";
import type { Friend, FriendRequest, HostSession, PublicUser, UserWithRelationship } from "@/lib/vibe-sdk";
import { useFriends } from "./hooks";
import { PresenceDot, usePresenceText } from "./presence";
import { errText, openDm, openSocial, refreshRequests, removeFriendLocal, requireClient, useSocial, vqk } from "./service";
import { openInviteAccept, openInviteFriends } from "./dialogs";

export function Avatar({ user, size = 32, presence }: { user: Pick<PublicUser, "id" | "name">; size?: number; presence?: Friend["presence"] | null }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <PlayerHead uuid={user.id} name={user.name} size={size} />
      {presence !== undefined && <PresenceDot presence={presence} className="absolute -bottom-0.5 -right-0.5" />}
    </span>
  );
}

export async function startDm(userId: string) {
  try {
    const c = await openDm(userId);
    openSocial(c.id);
  } catch (e) {
    toast.error(errText(e));
  }
}

// ------------------------------------------------------------------ Aktionen je Freund (Kontext- und Dropdown-Menü)

interface FriendAction {
  key: string;
  icon: ReactNode;
  label: string;
  danger?: boolean;
  sep?: boolean;
  onSelect: () => void;
}

function friendActions(friend: Friend, host?: HostSession): FriendAction[] {
  const t = tr;
  const u = friend.user;
  return [
    ...(host ? [{ key: "join", icon: <Play size={14} />, label: t("social.accept.join"), onSelect: () => openInviteAccept({ host }) }] : []),
    { key: "msg", icon: <MessageSquare size={14} />, label: t("social.friend.message"), onSelect: () => void startDm(u.id) },
    { key: "invite", icon: <Send size={14} />, label: t("social.friend.invite"), onSelect: () => openInviteFriends({ userIds: [u.id] }) },
    { key: "copy", icon: <Clipboard size={14} />, label: t("social.friend.copy_name"), onSelect: () => void writeText(u.name).then(() => toast.success(t("social.copied"))) },
    {
      key: "remove",
      sep: true,
      danger: true,
      icon: <UserMinus size={14} />,
      label: t("social.friend.remove"),
      onSelect: async () => {
        if (!(await confirm({ title: t("social.friend.remove_q", { name: u.name }), confirmLabel: t("social.friend.remove"), danger: true }))) return;
        try {
          await requireClient().friends.remove(u.id);
          removeFriendLocal(u.id);
        } catch (e) {
          toast.error(errText(e));
        }
      },
    },
    { key: "block", danger: true, icon: <Ban size={14} />, label: t("social.friend.block"), onSelect: () => void blockUser(u) },
  ];
}

/** Gleiche Einträge als Kontext- oder Dropdown-Menü. */
function ActionItems({ actions, kind }: { actions: FriendAction[]; kind: "context" | "dropdown" }) {
  const Item = kind === "context" ? ContextItem : DropdownItem;
  const Sep = kind === "context" ? ContextSeparator : DropdownSeparator;
  return (
    <>
      {actions.map((a) => (
        <Fragment key={a.key}>
          {a.sep && <Sep />}
          <Item icon={a.icon} danger={a.danger} onSelect={a.onSelect}>
            {a.label}
          </Item>
        </Fragment>
      ))}
    </>
  );
}

export function FriendMenuItems({ friend, host }: { friend: Friend; host?: HostSession }) {
  return <ActionItems actions={friendActions(friend, host)} kind="context" />;
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

const isActive = (f: Friend) => f.presence.status !== "offline" && (f.presence.activity?.type === "playing" || f.presence.activity?.type === "hosting");

// ------------------------------------------------------------------ Zeile auf der Freunde-Seite

/** Zeile: Kopf mit Status, Name, eine Statuszeile. Sichtbar höchstens „Beitreten“ (wenn gehostet) bzw. „Nachricht“
 *  beim Hover; alles Weitere im ⋯-Menü und per Rechtsklick. Doppelklick öffnet den Chat. */
export const FriendListRow = memo(function FriendListRow({ friend, host }: { friend: Friend; host?: HostSession }) {
  const t = useT();
  const ptext = usePresenceText();
  const offline = friend.presence.status === "offline";
  const active = isActive(friend);
  const actions = friendActions(friend, host);
  return (
    <ContextMenu content={<ActionItems actions={actions} kind="context" />}>
      <div
        className="group flex h-12 items-center gap-3 rounded-ctl px-3 transition-colors duration-100 hover:bg-white/[.04] data-[state=open]:bg-white/[.04]"
        onDoubleClick={() => void startDm(friend.user.id)}
      >
        <span className={cn(offline && "opacity-55 transition-opacity duration-100 group-hover:opacity-100")}>
          <Avatar user={friend.user} size={30} presence={friend.presence} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-[13.5px] font-semibold leading-tight", offline ? "text-muted" : "text-text")}>{friend.user.name}</div>
          <div className="truncate text-meta leading-tight">
            <span className={active ? "text-brand" : offline ? "text-dim" : "text-muted"}>{ptext(friend.presence)}</span>
            {friend.user.statusText && <span className="text-dim"> · „{friend.user.statusText}“</span>}
          </div>
        </div>
        {host ? (
          <Button size="sm" variant="ghost" icon={<Play size={13} />} onClick={() => openInviteAccept({ host })}>
            {t("social.accept.join")}
          </Button>
        ) : (
          <IconButton
            label={t("social.friend.message")}
            tip
            variant="ghost"
            size="sm"
            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => void startDm(friend.user.id)}
          >
            <MessageSquare size={15} />
          </IconButton>
        )}
        <DropdownMenu
          align="end"
          trigger={
            <IconButton
              label={t("social.chat.more")}
              variant="ghost"
              size="sm"
              className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <Ellipsis size={15} />
            </IconButton>
          }
        >
          <ActionItems actions={actions} kind="dropdown" />
        </DropdownMenu>
      </div>
    </ContextMenu>
  );
});

// ------------------------------------------------------------------ Kompaktes Panel (rechts neben jeder Seite)

export const FriendRow = memo(function FriendRow({ friend, compact }: { friend: Friend; compact?: boolean }) {
  const ptext = usePresenceText();
  const offline = friend.presence.status === "offline";
  return (
    <ContextMenu content={<FriendMenuItems friend={friend} />}>
      <button
        onClick={() => void startDm(friend.user.id)}
        className={cn(
          "group mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-ctl px-2 text-left transition-colors duration-100 hover:bg-white/[.04] data-[state=open]:bg-white/[.04]",
          compact ? "h-10" : "h-11",
          offline && "opacity-60 hover:opacity-100",
        )}
      >
        <Avatar user={friend.user} size={compact ? 26 : 28} presence={friend.presence} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-text">{friend.user.name}</span>
          <span className={cn("block truncate text-caption", isActive(friend) ? "text-brand" : "text-dim")}>
            {friend.user.statusText && offline ? friend.user.statusText : ptext(friend.presence)}
          </span>
        </span>
        <MessageSquare size={14} className="shrink-0 text-dim opacity-0 transition-opacity duration-100 group-hover:opacity-100" />
      </button>
    </ContextMenu>
  );
});

/** Ruhige Gruppenüberschrift in Listen (Panel, Postfach). */
export function GroupLabel({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-8 items-center justify-between px-3.5 pt-2", className)}>
      <span className="text-caption font-semibold text-dim">{children}</span>
      {right}
    </div>
  );
}

/** Kompakte Freundesliste für das rechte Panel (eingehende Anfragen, online, offline). */
export function FriendsTab({ compact }: { compact?: boolean }) {
  const t = useT();
  const friends = useFriends();
  const incoming = useSocial((s) => s.requests).filter((r) => r.direction === "incoming");
  const online = friends.filter((f) => f.presence.status !== "offline");
  const offline = friends.filter((f) => f.presence.status === "offline");
  return (
    <div className="scroll min-h-0 flex-1 pb-3">
      {incoming.length > 0 && (
        <>
          <GroupLabel>{t("social.req.title_in", { n: incoming.length })}</GroupLabel>
          {incoming.map((r) => (
            <RequestRow key={r.id} r={r} />
          ))}
        </>
      )}
      <GroupLabel>{t("social.friends.online", { n: online.length })}</GroupLabel>
      {online.length === 0 && <p className="px-3.5 py-1.5 text-[12px] text-dim">{friends.length ? t("social.friends.none_online") : t("social.friends.empty")}</p>}
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
    </div>
  );
}

// ------------------------------------------------------------------ Anfragen

/** Anfrage: sichtbar nur „Annehmen“ (eingehend) bzw. „Zurückziehen“ (ausgehend); Ablehnen und Blockieren im ⋯-Menü
 *  und per Rechtsklick. */
export function RequestRow({ r }: { r: FriendRequest }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const user = r.direction === "incoming" ? r.from : r.to;
  const incoming = r.direction === "incoming";
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
  const accept = () => void act(() => requireClient().friends.accept(r.id));
  const cancel = () => void act(() => requireClient().friends.cancel(r.id));
  const actions: FriendAction[] = [
    ...(incoming
      ? [
          { key: "accept", icon: <Check size={14} />, label: t("social.req.accept"), onSelect: accept },
          { key: "decline", icon: <X size={14} />, label: t("social.req.decline"), onSelect: () => void act(() => requireClient().friends.decline(r.id)) },
        ]
      : [{ key: "cancel", icon: <X size={14} />, label: t("social.req.cancel"), onSelect: cancel }]),
    { key: "block", sep: true, danger: true, icon: <Ban size={14} />, label: t("social.friend.block"), onSelect: () => void blockUser(user) },
  ];
  return (
    <ContextMenu content={<ActionItems actions={actions} kind="context" />}>
      <div className="mx-1.5 flex h-11 items-center gap-1.5 rounded-ctl pl-2 transition-colors duration-100 hover:bg-white/[.04] data-[state=open]:bg-white/[.04]">
        <Avatar user={user} size={26} />
        <span className="ml-1 min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-text">{user.name}</span>
          <span className="block truncate text-caption text-dim">{incoming ? t("social.req.incoming") : t("social.req.outgoing")}</span>
        </span>
        {busy ? (
          <span className="grid h-8 w-8 place-items-center">
            <Spinner size={12} />
          </span>
        ) : incoming ? (
          <IconButton label={t("social.req.accept")} tip variant="ghost" size="sm" onClick={accept}>
            <Check size={15} className="text-ok" />
          </IconButton>
        ) : (
          <IconButton label={t("social.req.cancel")} tip variant="ghost" size="sm" onClick={cancel}>
            <X size={15} />
          </IconButton>
        )}
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={t("social.chat.more")} variant="ghost" size="sm" disabled={busy}>
              <Ellipsis size={15} />
            </IconButton>
          }
        >
          <ActionItems actions={actions} kind="dropdown" />
        </DropdownMenu>
      </div>
    </ContextMenu>
  );
}

// ------------------------------------------------------------------ Suche (Dialog „Freund hinzufügen“)

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const h = setTimeout(() => setD(v), ms);
    return () => clearTimeout(h);
  }, [v, ms]);
  return d;
}

const NAME_RE = /^[A-Za-z0-9_]{2,25}$/;

export function AddFriendSearch() {
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
  const exact = results.some((u) => u.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (NAME_RE.test(q.trim())) void send({ name: q.trim() });
        }}
      >
        <SearchInput value={q} onChange={setQ} placeholder={t("social.add.placeholder")} aria-label={t("social.add.placeholder")} autoFocus />
      </form>
      <div className="min-h-[188px] rounded-card bg-surface">
        {dq.length < 2 ? (
          <div className="flex h-[188px] flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="max-w-[300px] text-[12.5px] text-muted">{t("social.add.hint")}</p>
          </div>
        ) : search.isLoading ? (
          <div className="flex flex-col gap-1 p-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : search.isError ? (
          <p className="px-3 py-3 text-[12.5px] text-danger">{errText(search.error)}</p>
        ) : (
          <div className="py-1">
            {results.map((u) => (
              <SearchResult key={u.id} u={u} busy={busy === u.id} onAdd={() => send({ userId: u.id })} />
            ))}
            {!results.length && <p className="px-3 py-3 text-[12.5px] text-dim">{t("social.add.none")}</p>}
            {!exact && NAME_RE.test(q.trim()) && (
              <button
                onClick={() => void send({ name: q.trim() })}
                disabled={!!busy}
                className="flex h-11 w-full items-center gap-2.5 px-3 text-left text-[13px] text-muted transition-colors hover:bg-white/[.04] hover:text-text"
              >
                <span className="grid h-7 w-7 place-items-center text-brand">{busy === q.trim() ? <Spinner size={12} /> : <Send size={14} />}</span>
                {t("social.add.by_name", { name: q.trim() })}
              </button>
            )}
          </div>
        )}
      </div>
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
    <div className="flex h-11 items-center gap-2.5 px-3">
      <Avatar user={u} size={28} />
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">{u.name}</span>
      {canAdd ? (
        <Button size="sm" variant="ghost" icon={busy ? <Spinner size={12} /> : <UserPlus size={14} />} onClick={onAdd} disabled={busy}>
          {u.relationship === "incoming" ? t("social.req.accept") : t("social.add.send")}
        </Button>
      ) : (
        <span className="text-caption text-dim">{label[u.relationship]}</span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Blockiert (Dialog)

export function BlockedList() {
  const t = useT();
  const q = useQuery({ queryKey: vqk.blocked, queryFn: () => requireClient().friends.blocked(), staleTime: 60_000 });
  if (q.isLoading)
    return (
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  if (q.isError) return <p className="text-[12.5px] text-danger">{errText(q.error)}</p>;
  if (!q.data?.length)
    return (
      <div className="py-8 text-center">
        <p className="text-[13px] text-muted">{t("social.blocked.none")}</p>
      </div>
    );
  return (
    <div className="rounded-card bg-surface">
      {q.data.map((u) => (
        <div key={u.id} className="flex h-12 items-center gap-2.5 border-line px-3 [&+&]:border-t">
          <Avatar user={u} size={28} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{u.name}</span>
          <Button
            size="sm"
            variant="ghost"
            icon={<ShieldOff size={13} />}

            onClick={async () => {
              try {
                await requireClient().friends.unblock(u.id);
                q.refetch();
              } catch (e) {
                toast.error(errText(e));
              }
            }}
          >
            {t("social.blocked.unblock")}
          </Button>
        </div>
      ))}
    </div>
  );
}
