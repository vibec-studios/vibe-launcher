// Ein Chat: Kopf mit Skin-Kopf und Aktivität, virtualisierter Verlauf in Nachrichtengruppen (ältere Seiten beim
// Hochscrollen), eigene Blasen in der Akzentfarbe, große Emojis, Einladungs- und Modpack-Karten, Gelesen-Status,
// Tipp-Anzeige, Eingabe mit Emoji-Auswahl.
import * as Popover from "@radix-ui/react-popover";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { copyText as writeText } from "@/components/content/util";
import { ChatShot } from "@/features/shotshare/ChatShot";
import { withoutShotLink } from "@/features/shotshare/api";
import { CheckCheck, Clipboard, Clock, Globe2, LogOut, Mail, MoreHorizontal, Package, PackageOpen, Pencil, Play, Send, Server, Smile, Trash2, UserPlus, Users } from "lucide-react";
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, ContextItem, ContextMenu, ContextSeparator, DropdownItem, DropdownMenu, DropdownSeparator, ErrorState, IconButton, Skeleton, Spinner, Textarea, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { Chat, Message, PublicUser } from "@/lib/vibe-sdk";
import { Avatar, startDm } from "./FriendsList";
import { chatTitle, dmPartner, idGte, useTypingUsers } from "./hooks";
import { ActivityIcon, isPlaying, loaderName, usePresenceParts } from "./presence";
import { errText, markRead, requireClient, sendMessage, sendTyping, useSocial, vibeClient, vqk, type MessagesPage } from "./service";
import { PackIcon } from "./dialogs";
import { openAddMembers, openInviteAccept, openInviteFriends, openPackImport, openRenameGroup } from "./dialogStore";
import { SealArt } from "./Overview";

const GROUP_GAP_MS = 5 * 60_000;

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(document.documentElement.lang || "de", { hour: "2-digit", minute: "2-digit" });
}
function dayOf(iso: string, t: (k: string) => string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return t("social.chat.today");
  if (d.toDateString() === yest.toDateString()) return t("social.chat.yesterday");
  return d.toLocaleDateString(document.documentElement.lang || "de", { weekday: "long", day: "numeric", month: "long" });
}

/** Nur Emojis (1–3, ohne sonstigen Text) -> groß darstellen. */
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u;

/** Eigene Blasen: Akzentfarbe flach abgemischt (kein Verlauf). */
const MINE_BG = "bg-[color-mix(in_srgb,var(--ui-accent)_26%,var(--surface-2))]";

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

/** Mehrere kleine Köpfe übereinander (Gruppen). */
export function AvatarStack({ users, size = 18, max = 3, ring = "var(--canvas)" }: { users: PublicUser[]; size?: number; max?: number; ring?: string }) {
  return (
    <span className="flex items-center -space-x-1.5">
      {users.slice(0, max).map((u) => (
        <span key={u.id} className="rounded-xs" style={{ boxShadow: `0 0 0 2px ${ring}` }}>
          <Avatar user={u} size={size} />
        </span>
      ))}
    </span>
  );
}

function ChatHeader({ chat, meId }: { chat: Chat; meId: string | undefined }) {
  const t = useT();
  const partner = dmPartner(chat, meId);
  const presence = useSocial((s) => (partner ? (s.friends[partner.id]?.presence ?? null) : undefined));
  const host = useSocial((s) => (partner ? Object.values(s.hosts).find((h) => h.host.id === partner.id && h.status === "online" && h.address) : undefined));
  const parts = usePresenceParts();
  const isOwner = chat.ownerId === meId;
  const p = presence ? parts(presence) : null;
  const others = chat.members.filter((m) => m.user.id !== meId).map((m) => m.user);
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line pl-5 pr-3">
      {partner ? (
        <Avatar user={partner} size={32} presence={presence} />
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-card bg-surface2 text-muted">
          <Users size={15} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-bold leading-tight text-text">{chatTitle(chat, meId)}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-tight">
          {partner ? (
            presence === undefined ? (
              <span className="text-dim">{t("social.chat.not_friend")}</span>
            ) : presence && isPlaying(presence) && p ? (
              <>
                <ActivityIcon activity={presence.activity} size={12} className="text-brand" />
                <span className="truncate text-muted">
                  {p.lead} <span className="font-medium text-text">{p.what}</span>
                  {p.detail && <span className="text-dim"> · {p.detail}</span>}
                </span>
              </>
            ) : (
              <span className="truncate text-dim">{p ? (presence?.status === "offline" && p.when ? p.when : p.what) : ""}</span>
            )
          ) : (
            <>
              <AvatarStack users={others} size={14} max={5} />
              <span className="truncate text-dim">{t("social.chat.members", { n: chat.members.length })}</span>
            </>
          )}
        </div>
      </div>
      {host && (
        <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => openInviteAccept({ host })}>
          {t("social.accept.join")}
        </Button>
      )}
      <IconButton label={t("social.chat.invite")} tip variant="ghost" size="sm" onClick={() => openInviteFriends(partner ? { userIds: [partner.id] } : { chatId: chat.id })}>
        <Mail size={15} />
      </IconButton>
      {chat.type === "group" && (
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={t("social.chat.more")} tip variant="ghost" size="sm">
              <MoreHorizontal size={16} />
            </IconButton>
          }
        >
          <DropdownItem icon={<UserPlus size={14} />} onSelect={() => openAddMembers(chat.id)}>
            {t("social.group.add_members")}
          </DropdownItem>
          {isOwner && (
            <DropdownItem icon={<Pencil size={14} />} onSelect={() => openRenameGroup(chat.id, chat.name ?? "")}>
              {t("social.group.rename")}
            </DropdownItem>
          )}
          <DropdownSeparator />
          <DropdownItem
            icon={<LogOut size={14} />}
            danger
            onSelect={async () => {
              try {
                if (meId) await requireClient().chats.removeMember(chat.id, meId);
              } catch (e) {
                toast.error(errText(e));
              }
            }}
          >
            {t("social.chat.leave")}
          </DropdownItem>
        </DropdownMenu>
      )}
    </div>
  );
}

type Row = { kind: "top" } | { kind: "day"; key: string; label: string } | { kind: "msg"; m: Message; head: boolean; tail: boolean };

function Messages({ chat, meId }: { chat: Chat; meId: string | undefined }) {
  const t = useT();
  const chatId = chat.id;
  const q = useInfiniteQuery({
    queryKey: vqk.messages(chatId),
    queryFn: ({ pageParam }) => requireClient().chats.messages(chatId, { before: pageParam, limit: 50 }) as Promise<MessagesPage>,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore && last.messages.length ? last.messages[last.messages.length - 1].id : undefined),
    staleTime: Infinity,
    placeholderData: undefined,
    enabled: !!vibeClient(),
  });

  // älteste -> neueste, mit Tagestrennern und Gruppierung nach Autor (head = erste, tail = letzte der Gruppe)
  const rows = useMemo<Row[]>(() => {
    const msgs = q.data ? q.data.pages.flatMap((p) => p.messages).slice().reverse() : [];
    const out: Row[] = [{ kind: "top" }];
    let prev: Message | null = null;
    const joins = (a: Message, b: Message) =>
      a.kind === "text" &&
      b.kind === "text" &&
      a.authorId === b.authorId &&
      Date.parse(b.createdAt) - Date.parse(a.createdAt) <= GROUP_GAP_MS &&
      new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString();
    msgs.forEach((m, i) => {
      const day = new Date(m.createdAt).toDateString();
      if (!prev || new Date(prev.createdAt).toDateString() !== day) out.push({ kind: "day", key: `d-${day}`, label: dayOf(m.createdAt, t) });
      const next = msgs[i + 1];
      out.push({ kind: "msg", m, head: !prev || !joins(prev, m), tail: !next || !joins(m, next) });
      prev = m;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.kind === "msg" ? ((rows[i] as { head: boolean }).head ? 58 : 30) : rows[i]?.kind === "day" ? 44 : 40),
    getItemKey: (i) => {
      const r = rows[i];
      return r.kind === "msg" ? r.m.id : r.kind === "day" ? r.key : "top";
    },
    overscan: 10,
  });

  // Scroll-Verhalten: unten kleben, beim Nachladen älterer Seiten Position halten
  const atBottom = useRef(true);
  const prev = useRef<{ first: string | null; last: string | null; total: number }>({ first: null, last: null, total: 0 });
  const firstId = rows.find((r) => r.kind === "msg") as { m: Message } | undefined;
  const lastRow = rows[rows.length - 1];
  const lastId = lastRow?.kind === "msg" ? lastRow.m.id : null;
  const lastMine = lastRow?.kind === "msg" && lastRow.m.authorId === meId;

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const p = prev.current;
    const first = firstId?.m.id ?? null;
    if (!p.last && lastId) {
      v.scrollToIndex(rows.length - 1, { align: "end" });
      requestAnimationFrame(() => v.scrollToIndex(rows.length - 1, { align: "end" }));
    } else if (first !== p.first && lastId === p.last && p.total) {
      el.scrollTop += v.getTotalSize() - p.total;
    } else if (lastId !== p.last && (atBottom.current || lastMine)) {
      v.scrollToIndex(rows.length - 1, { align: "end" });
      requestAnimationFrame(() => v.scrollToIndex(rows.length - 1, { align: "end" }));
    }
    prev.current = { first, last: lastId, total: v.getTotalSize() };
  }, [rows.length, firstId?.m.id, lastId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 240 && q.hasNextPage && !q.isFetchingNextPage) {
      prev.current.total = v.getTotalSize();
      void q.fetchNextPage();
    }
  };

  // Gelesen-Status: neueste eigene Nachricht
  const readInfo = useMemo(() => {
    const own = [...rows].reverse().find((r) => r.kind === "msg" && r.m.authorId === meId && !r.m.id.startsWith("tmp-")) as { m: Message } | undefined;
    if (!own) return null;
    const others = chat.members.filter((m) => m.user.id !== meId);
    const readers = others.filter((m) => idGte(m.lastReadMessageId, own.m.id));
    return { id: own.m.id, all: readers.length === others.length && others.length > 0, n: readers.length, dm: chat.type === "dm" };
  }, [rows, chat.members, chat.type, meId]);

  const [editing, setEditing] = useState<string | null>(null);

  if (q.isError && !q.data) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <ErrorState error={errText(q.error)} onRetry={() => q.refetch()} />
      </div>
    );
  }
  if (q.isLoading || !q.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 p-5">
        {[60, 40, 70, 30].map((w, i) => (
          <div key={i} className={cn("flex items-start gap-3", i % 2 && "flex-row-reverse")}>
            {!(i % 2) && <Skeleton className="h-8 w-8" />}
            <div className={cn("flex flex-col gap-1.5", i % 2 && "items-end")}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 rounded-card" style={{ width: `${w * 4}px` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const hasMessages = rows.some((r) => r.kind === "msg" && r.m.kind !== "system");
  if (!hasMessages) return <EmptyChat chat={chat} meId={meId} />;

  const members = Object.fromEntries(chat.members.map((m) => [m.user.id, m.user]));
  return (
    <div ref={parentRef} onScroll={onScroll} className="scroll min-h-0 flex-1 [overflow-anchor:none]">
      <div className="relative w-full" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((vi) => {
          const r = rows[vi.index];
          return (
            <div key={vi.key} data-index={vi.index} ref={v.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${vi.start}px)` }}>
              {r.kind === "top" ? (
                <div className="flex h-10 items-center justify-center text-[11.5px] text-dim">
                  {q.isFetchingNextPage ? <Spinner size={12} /> : q.hasNextPage ? "" : t("social.chat.start")}
                </div>
              ) : r.kind === "day" ? (
                <div className="flex items-center gap-3 px-5 pb-1 pt-5">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-[11.5px] font-semibold text-dim">{r.label}</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              ) : (
                <MessageRow
                  m={r.m}
                  head={r.head}
                  tail={r.tail}
                  author={r.m.authorId ? members[r.m.authorId] : undefined}
                  mine={r.m.authorId === meId}
                  canModerate={chat.ownerId === meId && chat.type === "group"}
                  editing={editing === r.m.id}
                  setEditing={setEditing}
                  read={readInfo?.id === r.m.id ? readInfo : null}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Leerer Chat: Robbe, kurzer Text und Vorschläge zum Losschreiben. */
function EmptyChat({ chat, meId }: { chat: Chat; meId: string | undefined }) {
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

interface MsgAction {
  key: string;
  icon: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  sep?: boolean;
  onSelect: () => void;
}

/** Gleiche Einträge für Rechtsklick und das ⋯ neben der Blase. */
function MsgItems({ actions, kind }: { actions: MsgAction[]; kind: "context" | "dropdown" }) {
  const Item = kind === "context" ? ContextItem : DropdownItem;
  const Sep = kind === "context" ? ContextSeparator : DropdownSeparator;
  return (
    <>
      {actions.map((a) => (
        <Fragment key={a.key}>
          {a.sep && <Sep />}
          <Item icon={a.icon} danger={a.danger} disabled={a.disabled} onSelect={a.onSelect}>
            {a.label}
          </Item>
        </Fragment>
      ))}
    </>
  );
}

/** Nachricht in einer Gruppe: andere links mit Kopf (nur erste der Gruppe), eigene rechts in der Akzentfarbe.
 *  Uhrzeit an der ersten Nachricht, bei Folgenachrichten beim Hover. Aktionen per Rechtsklick und ⋯. */
const MessageRow = memo(function MessageRow({
  m,
  head,
  tail,
  author,
  mine,
  canModerate,
  editing,
  setEditing,
  read,
}: {
  m: Message;
  head: boolean;
  tail: boolean;
  author: PublicUser | undefined;
  mine: boolean;
  canModerate: boolean;
  editing: boolean;
  setEditing: (id: string | null) => void;
  read: { all: boolean; n: number; dm: boolean } | null;
}) {
  const t = useT();
  const pending = m.id.startsWith("tmp-");
  if (m.kind === "system") return <SystemLine m={m} />;
  if (m.kind === "invite") return <InviteCardRow m={m} mine={mine} author={author} />;

  const jumbo = !m.deleted && EMOJI_ONLY.test(m.content.trim());
  const actions: MsgAction[] = [
    {
      key: "copy",
      icon: <Clipboard size={14} />,
      label: t("social.msg.copy"),
      disabled: m.deleted,
      onSelect: () => void writeText(m.content).then(() => toast.success(t("social.copied"))),
    },
  ];
  if (mine && !m.deleted && !pending) actions.push({ key: "edit", icon: <Pencil size={14} />, label: t("social.msg.edit"), onSelect: () => setEditing(m.id) });
  if ((mine || canModerate) && !m.deleted && !pending)
    actions.push({
      key: "delete",
      sep: true,
      danger: true,
      icon: <Trash2 size={14} />,
      label: t("social.msg.delete"),
      onSelect: () => void requireClient().chats.delete(m.chatId, m.id).catch((e) => toast.error(errText(e))),
    });

  // Ecken innerhalb einer Gruppe enger (nur wirksam bei runden Ecken)
  const shape = mine
    ? cn(!head && "rounded-tr-xs", !tail && "rounded-br-xs")
    : cn(!head && "rounded-tl-xs", !tail && "rounded-bl-xs");

  return (
    <ContextMenu content={<MsgItems actions={actions} kind="context" />}>
      <div className={cn("group relative flex gap-3 px-5", mine && "flex-row-reverse", head ? "pt-3" : "pt-[3px]", pending && "opacity-60")}>
        {!mine && (
          <div className="w-8 shrink-0">
            {head && author ? (
              <button onClick={() => void startDm(author.id)} className="block transition-transform duration-100 hover:-translate-y-px" aria-label={author.name}>
                <Avatar user={author} size={32} />
              </button>
            ) : (
              <span className="block pt-[7px] text-right text-[10px] tabular-nums text-dim opacity-0 transition-opacity group-hover:opacity-100">{timeOf(m.createdAt)}</span>
            )}
          </div>
        )}
        <div className={cn("flex min-w-0 flex-col", mine ? "items-end" : "items-start", editing ? "w-full max-w-[640px]" : "max-w-[min(620px,76%)]")}>
          {head && (
            <div className={cn("mb-1 flex items-baseline gap-2 px-0.5", mine && "flex-row-reverse")}>
              {!mine && <span className="text-[13px] font-semibold text-text">{author?.name ?? t("social.msg.unknown")}</span>}
              <span className="text-[11px] tabular-nums text-dim">{timeOf(m.createdAt)}</span>
            </div>
          )}
          {editing ? (
            <EditBox m={m} done={() => setEditing(null)} />
          ) : (
            <div className={cn("flex min-w-0 max-w-full items-center gap-1", mine && "flex-row-reverse")}>
              {m.deleted ? (
                <p className="rounded-card border border-dashed border-line2 px-3 py-1.5 text-[13px] italic text-dim">{t("social.chat.deleted")}</p>
              ) : jumbo ? (
                <p title={timeOf(m.createdAt)} className="selectable px-0.5 text-[34px] leading-[1.15]">
                  {m.content.trim()}
                </p>
              ) : (
                <p
                  title={timeOf(m.createdAt)}
                  className={cn("selectable min-w-0 whitespace-pre-wrap break-words rounded-card px-3.5 py-2 text-[13.5px] leading-[1.45] text-text", mine ? MINE_BG : "bg-surface2", shape)}
                >
                  {withoutShotLink(m.content) || m.content}
                  {m.editedAt && <span className="ml-1.5 text-[10.5px] text-dim">{t("social.msg.edited")}</span>}
                </p>
              )}
              {!m.deleted && (
                <DropdownMenu
                  align={mine ? "end" : "start"}
                  trigger={
                    <IconButton
                      label={t("social.chat.more")}
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal size={14} />
                    </IconButton>
                  }
                >
                  <MsgItems actions={actions} kind="dropdown" />
                </DropdownMenu>
              )}
            </div>
          )}
          {!editing && !m.deleted && <ChatShot content={m.content} mine={mine} />}
          {read && (
            <div className="mt-1 flex items-center gap-1 px-0.5 text-[11px] text-dim animate-fade-in">
              {(read.dm ? read.all : read.n > 0) && <CheckCheck size={12} className="text-brand" />}
              {read.dm ? (read.all ? t("social.msg.read") : t("social.msg.sent")) : read.n ? t("social.msg.read_by", { n: read.n }) : t("social.msg.sent")}
            </div>
          )}
        </div>
      </div>
    </ContextMenu>
  );
});

function EditBox({ m, done }: { m: Message; done: () => void }) {
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

function SystemLine({ m }: { m: Message }) {
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

/** Einladung im Chat als Karte: Art, Ziel, Version, Nachricht, Ablauf, Beitreten. Modpacks zeigen das geteilte
 *  Pack (Icon, Version, Dateien) und „Importieren“. */
function InviteCardRow({ m, mine, author }: { m: Message; mine: boolean; author: PublicUser | undefined }) {
  const t = useT();
  const inv = m.invite;
  const expired = inv ? Date.parse(inv.expiresAt) < Date.now() : true;
  const isPack = inv?.kind === "modpack";
  const pack = useQuery({
    queryKey: vqk.pack(inv?.packCode ?? ""),
    queryFn: () => requireClient().packs.get(inv!.packCode!),
    enabled: !!inv?.packCode && !!vibeClient(),
    retry: 0,
    staleTime: 60_000,
  });
  const Icon = isPack ? Package : inv?.kind === "server" ? Server : Globe2;
  const p = pack.data;
  return (
    <div className={cn("flex gap-3 px-5 pt-3", mine && "flex-row-reverse")}>
      {!mine && <div className="w-8 shrink-0">{author && <Avatar user={author} size={32} />}</div>}
      <div className={cn("flex min-w-0 max-w-[400px] flex-1 flex-col", mine && "items-end")}>
        <div className={cn("mb-1 flex items-baseline gap-2 px-0.5", mine && "flex-row-reverse")}>
          {!mine && <span className="text-[13px] font-semibold text-text">{author?.name ?? t("social.msg.unknown")}</span>}
          <span className="text-[11px] tabular-nums text-dim">{timeOf(m.createdAt)}</span>
        </div>
        <div className="w-full overflow-hidden rounded-card bg-surface2">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-[11.5px] font-semibold text-muted">
            <Icon size={13} className="text-brand" />
            {t(`social.invite.kind.${inv?.kind ?? "server"}`)}
          </div>
          <div className="flex items-center gap-3 px-3.5 py-3">
            {isPack && p ? (
              <PackIcon pack={p} size={44} />
            ) : (
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-card bg-white/[.05] text-muted">
                <Icon size={20} strokeWidth={1.8} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-bold leading-tight text-text">{p?.name ?? inv?.title ?? "—"}</div>
              <div className="mt-0.5 truncate text-[12px] text-muted">
                {isPack && p ? [p.mcVersion, loaderName(p.loader), p.latestVersion ? t("social.pack.files", { n: p.latestVersion.fileCount }) : null].filter(Boolean).join(" · ") : inv?.subtitle}
              </div>
            </div>
          </div>
          {m.content && <p className="selectable whitespace-pre-wrap break-words px-3.5 pb-3 text-[13px] leading-snug text-text">{m.content}</p>}
          <div className="flex items-center gap-2 bg-white/[.02] px-3.5 py-2.5">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] text-dim">
              <Clock size={12} />
              {expired ? t("social.invite.expired") : isPack ? t("social.invite.pack_code", { code: inv?.packCode ?? "" }) : t("social.invite.until", { time: timeOf(inv!.expiresAt) })}
            </span>
            {!mine && inv && !expired && (
              <Button
                size="sm"
                variant="primary"
                icon={isPack ? <PackageOpen size={13} /> : <Play size={13} />}
                onClick={() => (isPack && inv.packCode ? openPackImport(inv.packCode) : openInviteAccept({ inviteId: inv.inviteId }))}
              >
                {isPack ? t("social.invite.import") : t("social.accept.join")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** „X schreibt …“ mit drei blinkenden Pixeln. */
function TypingLine({ chat }: { chat: Chat }) {
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

const EMOJIS = ["😀", "😄", "😂", "🙂", "😉", "😍", "🤩", "😎", "🤔", "😅", "😴", "😭", "😡", "🥳", "🙌", "👍", "👎", "👋", "🙏", "💪", "❤️", "🔥", "✨", "🎉", "💎", "⛏️", "🗡️", "🏹", "🛡️", "🧱", "🌲", "🏝️", "🏰", "🐷", "🐑", "🐺", "🧟", "💀", "🍕", "🍪", "☕", "🎮", "🏆", "⭐", "✅", "❌", "👀", "💤"];

function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip content={t("social.chat.emoji")} side="top">
        <Popover.Trigger asChild>
          <button
            aria-label={t("social.chat.emoji")}
            className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.06] hover:text-text", open && "bg-white/[.06] text-text")}
          >
            <Smile size={17} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] w-[292px] rounded-card bg-overlay p-2 shadow-e2 outline-none data-[state=open]:animate-pop-in"
        >
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => onPick(e)}
                className="grid h-8 w-8 place-items-center rounded-ctl text-[19px] transition-[background-color,transform] duration-100 hover:scale-110 hover:bg-white/[.07]"
              >
                {e}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Composer({ chatId, placeholder }: { chatId: string; placeholder: string }) {
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
