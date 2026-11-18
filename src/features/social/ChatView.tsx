// Ein Chat: Kopf, virtualisierter Verlauf (ältere Seiten beim Hochscrollen), Gelesen-Status, Tippen, Eingabe.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { copyText as writeText } from "@/components/content/util";
import { Clipboard, Ellipsis, LogOut, Mail, Pencil, Send, Trash2, UserPlus, Users } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, ContextItem, ContextMenu, ContextSeparator, DropdownItem, DropdownMenu, DropdownSeparator, ErrorState, IconButton, Skeleton, Spinner, Textarea, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { Chat, Message } from "@/lib/vibe-sdk";
import { Avatar } from "./FriendsList";
import { chatTitle, dmPartner, idGte, useTypingUsers } from "./hooks";
import { usePresenceText } from "./presence";
import { errText, markRead, requireClient, sendMessage, sendTyping, useSocial, vibeClient, vqk, type MessagesPage } from "./service";
import { openAddMembers, openInviteAccept, openInviteFriends, openRenameGroup } from "./dialogs";

const GROUP_GAP_MS = 5 * 60_000;

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(document.documentElement.lang || "de", { hour: "2-digit", minute: "2-digit" });
}
function dayOf(iso: string) {
  return new Date(iso).toLocaleDateString(document.documentElement.lang || "de", { weekday: "short", day: "2-digit", month: "long" });
}

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

function ChatHeader({ chat, meId }: { chat: Chat; meId: string | undefined }) {
  const t = useT();
  const partner = dmPartner(chat, meId);
  const presence = useSocial((s) => (partner ? (s.friends[partner.id]?.presence ?? null) : undefined));
  const ptext = usePresenceText();
  const isOwner = chat.ownerId === meId;
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
      {partner ? (
        <Avatar user={partner} size={32} presence={presence} />
      ) : (
        <span className="grid h-8 w-8 place-items-center border border-line2 bg-surface2 text-muted">
          <Users size={15} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-white">{chatTitle(chat, meId)}</div>
        <div className="truncate text-[11px] text-dim">
          {partner ? (presence === undefined ? t("social.chat.not_friend") : ptext(presence)) : t("social.chat.members", { n: chat.members.length })}
        </div>
      </div>
      <Tooltip content={t("social.chat.invite")}>
        <IconButton label={t("social.chat.invite")} size="sm" onClick={() => openInviteFriends(partner ? { userIds: [partner.id] } : { chatId: chat.id })}>
          <Mail size={15} />
        </IconButton>
      </Tooltip>
      {chat.type === "group" && (
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={t("social.chat.more")} size="sm">
              <Ellipsis size={15} />
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

type Row = { kind: "top" } | { kind: "day"; key: string; label: string } | { kind: "msg"; m: Message; head: boolean };

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

  // älteste -> neueste, mit Tagestrennern und Gruppierung nach Autor
  const rows = useMemo<Row[]>(() => {
    const msgs = q.data ? q.data.pages.flatMap((p) => p.messages).slice().reverse() : [];
    const out: Row[] = [{ kind: "top" }];
    let prev: Message | null = null;
    for (const m of msgs) {
      const day = new Date(m.createdAt).toDateString();
      if (!prev || new Date(prev.createdAt).toDateString() !== day) out.push({ kind: "day", key: `d-${day}`, label: dayOf(m.createdAt) });
      const head =
        !prev ||
        prev.kind !== "text" ||
        m.kind !== "text" ||
        prev.authorId !== m.authorId ||
        Date.parse(m.createdAt) - Date.parse(prev.createdAt) > GROUP_GAP_MS ||
        new Date(prev.createdAt).toDateString() !== day;
      out.push({ kind: "msg", m, head });
      prev = m;
    }
    return out;
  }, [q.data]);

  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.kind === "msg" ? ((rows[i] as { head: boolean }).head ? 52 : 24) : rows[i]?.kind === "day" ? 34 : 40),
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
      // erster Inhalt: ganz nach unten
      v.scrollToIndex(rows.length - 1, { align: "end" });
      requestAnimationFrame(() => v.scrollToIndex(rows.length - 1, { align: "end" }));
    } else if (first !== p.first && lastId === p.last && p.total) {
      // ältere Seite oben angefügt
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
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 p-4">
        {[60, 40, 70, 30].map((w, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="h-8 w-8" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4" style={{ width: `${w * 4}px` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const members = Object.fromEntries(chat.members.map((m) => [m.user.id, m.user]));
  return (
    <div ref={parentRef} onScroll={onScroll} className="scroll min-h-0 flex-1 [overflow-anchor:none]">
      <div className="relative w-full" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((vi) => {
          const r = rows[vi.index];
          return (
            <div key={vi.key} data-index={vi.index} ref={v.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${vi.start}px)` }}>
              {r.kind === "top" ? (
                <div className="flex h-10 items-center justify-center text-[11px] text-dim">
                  {q.isFetchingNextPage ? <Spinner size={12} /> : q.hasNextPage ? "" : t("social.chat.start")}
                </div>
              ) : r.kind === "day" ? (
                <div className="flex items-center gap-3 px-4 py-2">
                  <span className="h-px flex-1 bg-line" />
                  <span className="font-mono text-[10px] uppercase tracking-[.12em] text-dim">{r.label}</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              ) : (
                <MessageRow
                  m={r.m}
                  head={r.head}
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

const MessageRow = memo(function MessageRow({
  m,
  head,
  author,
  mine,
  canModerate,
  editing,
  setEditing,
  read,
}: {
  m: Message;
  head: boolean;
  author: { id: string; name: string } | undefined;
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

  const menu = (
    <>
      <ContextItem icon={<Clipboard size={14} />} disabled={m.deleted} onSelect={() => writeText(m.content).then(() => toast.success(t("social.copied")))}>
        {t("social.msg.copy")}
      </ContextItem>
      {mine && !m.deleted && !pending && (
        <ContextItem icon={<Pencil size={14} />} onSelect={() => setEditing(m.id)}>
          {t("social.msg.edit")}
        </ContextItem>
      )}
      {(mine || canModerate) && !m.deleted && !pending && (
        <>
          <ContextSeparator />
          <ContextItem
            icon={<Trash2 size={14} />}
            danger
            onSelect={() => requireClient().chats.delete(m.chatId, m.id).catch((e) => toast.error(errText(e)))}
          >
            {t("social.msg.delete")}
          </ContextItem>
        </>
      )}
    </>
  );

  return (
    <ContextMenu content={menu}>
      <div className={cn("group flex gap-3 px-4 hover:bg-white/[.02]", head ? "pt-2.5" : "pt-0.5", pending && "opacity-55")}>
        <div className="w-8 shrink-0">{head && author && <Avatar user={author} size={32} />}</div>
        <div className="min-w-0 flex-1 pb-0.5">
          {head && (
            <div className="flex items-baseline gap-2">
              <span className={cn("text-[13px] font-semibold", mine ? "text-brand" : "text-white")}>{author?.name ?? t("social.msg.unknown")}</span>
              <span className="font-mono text-[10px] text-dim">{timeOf(m.createdAt)}</span>
            </div>
          )}
          {editing ? (
            <EditBox m={m} done={() => setEditing(null)} />
          ) : m.deleted ? (
            <p className="text-[13px] italic text-dim">{t("social.chat.deleted")}</p>
          ) : (
            <p className="selectable whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-text">
              {m.content}
              {m.editedAt && <span className="ml-1.5 text-[10px] text-dim">{t("social.msg.edited")}</span>}
            </p>
          )}
          {read && (
            <div className="mt-0.5 font-mono text-[10px] text-dim animate-fade-in">
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
    <div className="mt-1">
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
      <div className="mt-1 flex items-center gap-2 text-[11px] text-dim">
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
  const text = !s
    ? m.content
    : t(`social.sys.${s.event}`, { actor: name(s.actorId), target: name(s.targetId), name: s.name ?? "" });
  return <div className="px-4 py-1.5 text-center text-[11px] text-dim">{text} · {timeOf(m.createdAt)}</div>;
}

function InviteCardRow({ m, mine, author }: { m: Message; mine: boolean; author: { id: string; name: string } | undefined }) {
  const t = useT();
  const inv = m.invite;
  const expired = inv ? Date.parse(inv.expiresAt) < Date.now() : true;
  return (
    <div className="flex gap-3 px-4 pt-2.5">
      <div className="w-8 shrink-0">{author && <Avatar user={author} size={32} />}</div>
      <div className="min-w-0 max-w-[420px] flex-1 border border-line2 bg-surface2 p-3">
        <div className="eyebrow">{t(`social.invite.kind.${inv?.kind ?? "server"}`)}</div>
        <div className="mt-1 truncate text-[14px] font-semibold text-white">{inv?.title ?? "—"}</div>
        {inv?.subtitle && <div className="truncate text-[12px] text-muted">{inv.subtitle}</div>}
        {m.content && <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] text-text">{m.content}</p>}
        <div className="mt-2.5 flex items-center gap-2">
          {!mine && inv && !expired && (
            <Button size="sm" variant="primary" icon={<Send size={13} />} onClick={() => openInviteAccept({ inviteId: inv.inviteId })}>
              {t("social.invite.accept")}
            </Button>
          )}
          <span className="font-mono text-[10px] text-dim">
            {expired ? t("social.invite.expired") : t("social.invite.until", { time: timeOf(inv!.expiresAt) })}
          </span>
        </div>
      </div>
    </div>
  );
}

function TypingLine({ chat }: { chat: Chat }) {
  const t = useT();
  const ids = useTypingUsers(chat.id);
  const names = ids.map((id) => chat.members.find((m) => m.user.id === id)?.user.name).filter(Boolean) as string[];
  return (
    <div className="h-5 shrink-0 px-4 text-[11px] text-brand">
      {names.length > 0 && (
        <span className="animate-fade-in">
          {names.length === 1 ? t("social.chat.typing_one", { name: names[0] }) : t("social.chat.typing_many", { n: names.length })}
        </span>
      )}
    </div>
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
  const rows = Math.min(6, Math.max(1, text.split("\n").length));
  return (
    <div className="shrink-0 border-t border-line p-3">
      <div className="flex items-end gap-2">
        <Textarea
          ref={ref}
          value={text}
          rows={rows}
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
          className="max-h-40 min-h-[38px] resize-none py-2 text-[13px]"
        />
        <IconButton label={t("social.chat.send")} onClick={send} disabled={!text.trim() || !chatOn} className="h-[38px] w-[38px]">
          <Send size={15} />
        </IconButton>
      </div>
      {text.length > max - 200 && <div className="mt-1 text-right font-mono text-[10px] text-dim">{text.length}/{max}</div>}
    </div>
  );
}
