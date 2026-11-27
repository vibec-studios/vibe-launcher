import type { TicketDetail, TicketMessage, TicketReplyDraft, TicketStatus, TicketSummary } from "@/lib/types";
import type { Handlers } from "./util";

const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

function flag(): string | null {
  try {
    return localStorage.getItem("vl.mock.tickets");
  } catch {
    return null;
  }
}

const team = { type: "team" as const, name: "Vibe-Team" };
const me = { type: "user" as const, name: "Steve" };
const THUMB = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#16141f"/><rect x="0" y="0" width="40" height="200" fill="#211e2e"/><rect x="60" y="30" width="80" height="60" fill="#2a2640"/><rect x="160" y="30" width="80" height="60" fill="#2a2640"/></svg>')}`;
const log = (id: string, filename: string, size: number, messageId: number | null) => ({
  id,
  kind: "log" as const,
  filename,
  contentType: "text/plain; charset=utf-8",
  size,
  available: true,
  url: `/api/v1/tickets/x/attachments/${id}`,
  messageId,
  createdAt: ago(600),
});

function msg(id: number, p: Partial<TicketMessage>): TicketMessage {
  return { id, kind: "message", author: team, body: "", requestId: null, fulfills: [], data: null, attachments: [], createdAt: ago(100 - id), ...p };
}

function detail(base: Omit<TicketDetail, "openRequests" | "canReply" | "updatedAt" | "app" | "channel" | "userReadAt">): TicketDetail {
  return {
    ...base,
    app: "launcher",
    channel: "release",
    updatedAt: base.lastActivityAt,
    userReadAt: null,
    openRequests: base.requests.filter((r) => r.status === "open").length,
    canReply: base.status !== "rejected",
  };
}

const db = new Map<string, TicketDetail>();

function seed() {
  db.clear();
  db.set(
    "VB-1042",
    detail({
      id: "t-1042",
      ticket: "VB-1042",
      kind: "bug",
      status: "waiting",
      version: "1.0.0-beta.8",
      createdAt: ago(1440),
      lastActivityAt: ago(35),
      unread: true,
      local: true,
      message: "Der Launcher stürzt ab, sobald ich die Instanz „Fabric 1.21.1“ starte. Vorher kommt kurz ein schwarzes Fenster.",
      contact: "discord: steve",
      attachments: [log("a1", "launcher.log", 48_211, null)],
      report: null,
      messages: [
        msg(1, { body: "Danke für die Meldung! Wir schauen uns das an.", createdAt: ago(900) }),
        msg(2, { kind: "status", author: { type: "system", name: "System" }, body: "Status: In Bearbeitung", data: { from: "new", to: "in_progress" }, createdAt: ago(899) }),
        msg(3, { kind: "request", body: "Kannst du uns das latest.log der Instanz schicken?", requestId: "r-log", data: { type: "log" }, createdAt: ago(40) }),
        msg(4, { kind: "request", body: "Und einen Screenshot vom schwarzen Fenster, falls möglich.", requestId: "r-shot", data: { type: "screenshot" }, createdAt: ago(35) }),
      ],
      requests: [
        { id: "r-log", type: "log", message: "Kannst du uns das latest.log der Instanz schicken?", status: "open", createdAt: ago(40), fulfilledAt: null, fulfilledByMessageId: null, cancelledAt: null },
        { id: "r-shot", type: "screenshot", message: "Und einen Screenshot vom schwarzen Fenster, falls möglich.", status: "open", createdAt: ago(35), fulfilledAt: null, fulfilledByMessageId: null, cancelledAt: null },
      ],
    }),
  );
  db.set(
    "VB-1031",
    detail({
      id: "t-1031",
      ticket: "VB-1031",
      kind: "idea",
      status: "in_progress",
      version: "1.0.0-beta.7",
      createdAt: ago(6000),
      lastActivityAt: ago(300),
      unread: true,
      message: "Eine Sortierung nach „zuletzt gespielt“ in der Bibliothek wäre super.",
      contact: null,
      attachments: [],
      report: null,
      messages: [
        msg(1, { author: me, body: "Am besten auch im Simple-Modus.", createdAt: ago(5000) }),
        msg(2, { body: "Gute Idee, wir planen das für die nächste Beta ein.", createdAt: ago(300) }),
        msg(3, { kind: "request", body: "Welche Ansicht nutzt du meistens, Kacheln oder Liste?", requestId: "r-text", data: { type: "text" }, createdAt: ago(299) }),
      ],
      requests: [{ id: "r-text", type: "text", message: "Welche Ansicht nutzt du meistens, Kacheln oder Liste?", status: "open", createdAt: ago(299), fulfilledAt: null, fulfilledByMessageId: null, cancelledAt: null }],
    }),
  );
  db.set(
    "VB-998",
    detail({
      id: "t-998",
      ticket: "VB-998",
      kind: "bug",
      status: "done",
      version: "1.0.0-beta.5",
      createdAt: ago(30_000),
      lastActivityAt: ago(20_000),
      unread: false,
      local: true,
      message: "Beim Import eines Modpacks hängt der Fortschritt bei 99 %.",
      contact: null,
      attachments: [{ ...log("a9", "crash-2026-10-02_18.11.00-client.txt", 9_812, null), available: false, url: null }],
      report: null,
      messages: [
        msg(1, { body: "Behoben in 1.0.0-beta.6. Danke!", createdAt: ago(20_001) }),
        msg(2, { kind: "status", author: { type: "system", name: "System" }, body: "Status: Erledigt", data: { from: "in_progress", to: "done" }, createdAt: ago(20_000) }),
      ],
      requests: [],
    }),
  );
  db.set(
    "VB-1050",
    detail({
      id: "t-1050",
      ticket: "VB-1050",
      kind: "report",
      status: "new",
      version: "1.0.0-beta.8",
      createdAt: ago(120),
      lastActivityAt: ago(120),
      unread: false,
      message: "Beleidigt mich seit Tagen.",
      contact: null,
      attachments: [],
      report: { reason: "harassment", status: "open", chatName: null, messages: 3 },
      messages: [],
      requests: [],
    }),
  );
}
seed();

function summary(d: TicketDetail): TicketSummary {
  const { message, contact: _c, channel: _ch, attachments: _a, report: _r, messages: _m, requests: _q, userReadAt: _u, ...rest } = d;
  return { ...rest, excerpt: message.slice(0, 160) };
}

function find(key: string): TicketDetail {
  const d = db.get(String(key).toUpperCase());
  if (!d) throw { kind: "ticket", http: 404, code: "not_found", message: "Ticket nicht gefunden", retry_after: null, details: null };
  return d;
}

function post(key: string, body: string, fulfills: string[], files: TicketMessage["attachments"]) {
  const d = find(key);
  if (d.status === "rejected") throw { kind: "ticket", http: 409, code: "ticket_closed", message: "closed", retry_after: null, details: null };
  const id = (d.messages.at(-1)?.id ?? 0) + 1;
  const m = msg(id, { author: me, body: body.trim(), fulfills, attachments: files, createdAt: new Date().toISOString() });
  const requests = d.requests.map((r) => (fulfills.includes(r.id) ? { ...r, status: "fulfilled" as const, fulfilledAt: m.createdAt, fulfilledByMessageId: id } : r));
  const status: TicketStatus = d.status === "waiting" || d.status === "done" ? "in_progress" : d.status;
  const msgs = [...d.messages, m];
  if (status !== d.status) msgs.push(msg(id + 1, { kind: "status", author: { type: "system", name: "System" }, body: "", data: { from: d.status, to: status }, createdAt: m.createdAt }));
  db.set(d.ticket, { ...d, status, messages: msgs, requests, openRequests: requests.filter((r) => r.status === "open").length, lastActivityAt: m.createdAt, unread: false });
  return { message: m, status, fulfilled: fulfills };
}

let prepared: TicketReplyDraft | null = null;

const handlers: Handlers = {
  tickets_local: () => (flag() === "none" ? [] : [...db.values()].filter((d) => d.local).map((d) => ({ id: d.id, ticket: d.ticket, added: Date.parse(d.createdAt) }))),
  tickets_list: () => {
    if (flag() === "offline") throw { kind: "network", http: 0, code: "offline", message: "error sending request", retry_after: null, details: null };
    const items = flag() === "none" ? [] : [...db.values()].map(summary);
    return { items, account: true, complete: true };
  },
  ticket_get: ({ ticket, after }) => {
    const d = find(String(ticket));
    const a = Number(after ?? 0);
    return { ...d, messages: a > 0 ? d.messages.filter((m) => m.id > a) : d.messages };
  },
  ticket_read: ({ ticket }) => {
    const d = find(String(ticket));
    db.set(d.ticket, { ...d, unread: false, userReadAt: new Date().toISOString() });
    return null;
  },
  ticket_reply: ({ ticket, body, fulfills }) => post(String(ticket), String(body), (fulfills as string[]) ?? [], []),
  ticket_reply_preview: ({ draft }) => {
    const d = draft as TicketReplyDraft;
    prepared = d;
    const logs = d.logs.map((k) => {
      const name = k === "launcher" ? "launcher.log" : k === "game" ? "latest.log" : "crash-2026-11-27_10.43.04-client.txt";
      const text = `[10:42:21] [main/INFO]: Loading Minecraft 1.21.1 (${k})\n[10:42:30] [Render thread/INFO]: Setting user: <user>\n`;
      return { name, original_bytes: 120_000, bytes: text.length, truncated: k !== "crash", redactions: 1, text };
    });
    const screenshots = d.screenshots.map((id) => ({ id, name: "screenshot.png", mime: "image/png", bytes: 412_334, width: 1280, height: 800, thumb: THUMB }));
    return { token: "mock-reply", ticket: d.ticket, body: d.body.trim(), logs, screenshots, total_bytes: 400 + logs.reduce((s, l) => s + l.bytes, 0) + screenshots.length * 412_334 };
  },
  ticket_reply_send: async () => {
    await new Promise((r) => setTimeout(r, 600));
    const d = prepared;
    if (!d) throw { kind: "invalid", http: 0, code: "preview_expired", message: "expired", retry_after: null, details: null };
    prepared = null;
    const files = [
      ...d.logs.map((k, i) => log(`n-${Date.now()}-${i}`, k === "launcher" ? "launcher.log" : k === "game" ? "latest.log" : "crash-report.txt", 2048, null)),
      ...d.screenshots.map((_, i) => ({ ...log(`s-${Date.now()}-${i}`, "screenshot.png", 412_334, null), kind: "screenshot" as const, contentType: "image/png" })),
    ];
    return post(d.ticket, d.body, d.fulfills, files);
  },
  ticket_attachment: ({ id }) => ({ mime: "text/plain", text: `[mock] Anhang ${String(id)}\n[10:42:21] [main/INFO]: Loading Minecraft 1.21.1\n`, data_url: null }),
  ticket_report_chat: async ({ report }) => {
    await new Promise((r) => setTimeout(r, 500));
    const r = report as { chat_id: string; reason: string; details: string | null };
    if (flag() === "conflict") throw { kind: "ticket", http: 409, code: "conflict", message: "exists", retry_after: null, details: { ticket: "VB-1050" } };
    const n = 1060 + db.size;
    const d = detail({
      id: `t-${n}`,
      ticket: `VB-${n}`,
      kind: "report",
      status: "new",
      version: "1.0.0-beta.8",
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      unread: false,
      local: true,
      message: r.details ?? "",
      contact: null,
      attachments: [],
      report: { reason: r.reason, status: "open", chatName: null, messages: 1 },
      messages: [],
      requests: [],
    });
    db.set(d.ticket, d);
    return { id: d.id, ticket: d.ticket };
  },
};

export default handlers;
