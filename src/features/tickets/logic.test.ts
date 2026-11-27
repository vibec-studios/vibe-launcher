import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionCount, isOpenTicket, mergeList, mergeMessages, needsAttention, presetLogs, sortedTickets } from "./logic.ts";
import type { TicketMessage, TicketSummary } from "@/lib/types";

const summary = (id: string, p: Partial<TicketSummary> = {}): TicketSummary => ({
  id,
  ticket: `VB-${id}`,
  kind: "bug",
  status: "new",
  excerpt: "x",
  app: "launcher",
  version: "1.0.0",
  createdAt: "2026-11-20T10:00:00.000Z",
  updatedAt: "2026-11-20T10:00:00.000Z",
  lastActivityAt: "2026-11-20T10:00:00.000Z",
  unread: false,
  openRequests: 0,
  canReply: true,
  ...p,
});

const message = (id: number, body = ""): TicketMessage => ({
  id,
  kind: "message",
  author: { type: "team", name: "Vibe-Team" },
  body,
  requestId: null,
  fulfills: [],
  data: null,
  attachments: [],
  createdAt: "2026-11-20T10:00:00.000Z",
});

test("attention: unread or open requests on a ticket that accepts replies", () => {
  assert.equal(needsAttention(summary("1")), false);
  assert.equal(needsAttention(summary("1", { unread: true })), true);
  assert.equal(needsAttention(summary("1", { openRequests: 2 })), true);
  assert.equal(needsAttention(summary("1", { openRequests: 2, canReply: false })), false);
  assert.equal(attentionCount({ a: summary("a", { unread: true }), b: summary("b"), c: summary("c", { openRequests: 1 }) }), 2);
});

test("sorted by last activity, newest first", () => {
  const list = sortedTickets({ a: summary("a"), b: summary("b", { lastActivityAt: "2026-11-27T10:00:00.000Z" }) });
  assert.deepEqual(
    list.map((i) => i.id),
    ["b", "a"],
  );
});

test("complete list replaces, partial list merges", () => {
  const prev = { a: summary("a"), b: summary("b") };
  const full = mergeList(prev, { items: [summary("a", { unread: true })], account: true, complete: true });
  assert.deepEqual(Object.keys(full.items), ["a"]);
  assert.deepEqual(
    full.fresh.map((i) => i.id),
    ["a"],
  );
  const part = mergeList(prev, { items: [summary("c", { unread: true })], account: false, complete: false });
  assert.deepEqual(Object.keys(part.items).sort(), ["a", "b", "c"]);
  assert.equal(part.fresh.length, 0);
});

test("incremental messages are merged by id", () => {
  const merged = mergeMessages([message(1), message(2, "alt")], [message(2, "neu"), message(3)]);
  assert.deepEqual(
    merged.map((m) => [m.id, m.body]),
    [
      [1, ""],
      [2, "neu"],
      [3, ""],
    ],
  );
});

test("request presets and open filter", () => {
  assert.deepEqual(presetLogs({ type: "crash_report" }), ["crash"]);
  assert.deepEqual(presetLogs({ type: "log" }), ["launcher", "game"]);
  assert.deepEqual(presetLogs({ type: "screenshot" }), []);
  assert.equal(isOpenTicket({ status: "waiting" }), true);
  assert.equal(isOpenTicket({ status: "rejected" }), false);
});
