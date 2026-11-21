import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorState, Skeleton, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { Chat, Message } from "@/lib/vibe-sdk";
import { idGte } from "../hooks";
import { errText, requireClient, vibeClient, vqk, type MessagesPage } from "../service";
import { EmptyChat } from "./EmptyChat";
import { MessageRow } from "./MessageRow";
import { dayOf, GROUP_GAP_MS, type Row } from "./utils";

export function Messages({ chat, meId }: { chat: Chat; meId: string | undefined }) {
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
