// Mock: simuliertes Vibe-Backend (REST `vibe_http` + Gateway `vibe_ws_*`) mit realistischem Datensatz für die
// Freunde-Seite – Freunde online/offline/hostend, Chats mit Einladungs- und Modpack-Karten, Anfragen, Tippen.
// Nur für VITE_MOCK=1 (Browser), nie im Produktions-Build. Skins: echte Texturen über mc-heads.net.
import type { VibeHttpRequest, VibeHttpResponse, VibeStatus, VibeTokens } from "@/lib/types";
import type {
  Chat,
  ChatMember,
  Friend,
  FriendRequest,
  HostSession,
  Invite,
  InviteCard,
  Me,
  Message,
  Pack,
  Presence,
  PublicUser,
  ServerMeta,
  UserWithRelationship,
} from "@/lib/vibe-sdk";
import { emit } from "@tauri-apps/api/event";
import type { Handlers } from "./util";

const API = "https://vibe.mock";
const NOW = Date.now();
const min = (n: number) => new Date(NOW - n * 60_000).toISOString();
const iso = () => new Date().toISOString();

/** Nutzer mit echtem Skin (Textur über mc-heads.net, Name der Skin-Quelle) */
function user(id: string, name: string, skinOf: string, extra: Partial<PublicUser> = {}): PublicUser {
  return {
    id,
    name,
    skin: { url: `https://mc-heads.net/skin/${skinOf}`, model: "classic", capeUrl: null },
    statusText: null,
    badge: "user",
    createdAt: min(60 * 24 * 200),
    ...extra,
  };
}

const ME: Me = {
  ...user("069a79f4-44e9-4726-a5be-fca90e38aaf5", "Henny", "069a79f444e94726a5befca90e38aaf5"),
  statusText: "Baue an der Werft 🚢",
  privacy: { friendRequests: "everyone", directMessages: "friends", invites: "friends", showHosting: true },
  limits: { maxHosts: 2, maxPlayersPerHost: 8, maxPacks: 10, maxFriends: 200, maxPackOverridesMb: 200 },
  presenceStatus: "online",
};

const U = {
  lumi: user("a1b2c3d4-0000-4000-8000-000000000001", "Lumi_Builds", "jeb_", { statusText: "Insel-Survival läuft – kommt rein!", badge: "supporter" }),
  kai: user("a1b2c3d4-0000-4000-8000-000000000002", "KaiCraft", "TommyInnit"),
  mira: user("a1b2c3d4-0000-4000-8000-000000000003", "mira_px", "LDShadowLady"),
  toast: user("a1b2c3d4-0000-4000-8000-000000000004", "Toastbrot", "Technoblade", { statusText: "afk, Pizza 🍕" }),
  nord: user("a1b2c3d4-0000-4000-8000-000000000005", "Nordlicht", "Marc"),
  bau: user("a1b2c3d4-0000-4000-8000-000000000006", "derBaumeister", "CaptainSparklez", { statusText: "Kathedrale, Tag 12" }),
  paula: user("a1b2c3d4-0000-4000-8000-000000000007", "PixelPaula", "GeorgeNotFound", { statusText: "Bis Sonntag im Urlaub ☀️" }),
  fjord: user("a1b2c3d4-0000-4000-8000-000000000008", "Fjordwal", "deadmau5"),
  grummel: user("a1b2c3d4-0000-4000-8000-000000000009", "Grummel", "Notch"),
  schnee: user("a1b2c3d4-0000-4000-8000-000000000010", "Schneeflocke", "Ph1LzA"),
  welle: user("a1b2c3d4-0000-4000-8000-000000000011", "Wellenreiter", "xNestorio"),
  troll: user("a1b2c3d4-0000-4000-8000-000000000012", "Spamkönig", "Sapnap"),
};

function presence(u: PublicUser, status: Presence["status"], activity: Presence["activity"] = null): Presence {
  return { userId: u.id, status, activity, updatedAt: min(3) };
}

const friends = new Map<string, Friend>(
  (
    [
      [U.lumi, presence(U.lumi, "online", { type: "hosting", world: "Insel-Survival", instanceName: "Insel-Survival", mcVersion: "1.21.4", loader: "fabric", joinable: true, startedAt: min(48) })],
      [U.kai, presence(U.kai, "online", { type: "playing", instanceName: "Create: Above & Beyond", mcVersion: "1.18.2", loader: "forge", startedAt: min(42) })],
      [U.mira, presence(U.mira, "online", { type: "playing", server: "smp.vibecraft.de", mcVersion: "1.21.4", loader: "vanilla", startedAt: min(95) })],
      [U.toast, presence(U.toast, "away", { type: "launcher" })],
      [U.nord, presence(U.nord, "online", { type: "launcher" })],
      [U.bau, presence(U.bau, "busy", { type: "playing", world: "Kathedrale", instanceName: "Creative 1.21", mcVersion: "1.21.1", loader: "fabric", startedAt: min(180) })],
      [U.paula, presence(U.paula, "offline")],
      [U.fjord, presence(U.fjord, "offline")],
      [U.grummel, presence(U.grummel, "offline")],
    ] as const
  ).map(([u, p], i) => [u.id, { user: u, since: min(60 * 24 * (30 + i * 17)), presence: { ...p, updatedAt: p.status === "offline" ? min(60 * (2 + i * 9)) : p.updatedAt } }]),
);

let requests: FriendRequest[] = [
  { id: "rq1", from: U.schnee, to: ME, createdAt: min(25), direction: "incoming" },
  { id: "rq2", from: ME, to: U.welle, createdAt: min(60 * 26), direction: "outgoing" },
];
let blocked: PublicUser[] = [U.troll];

const hostLumi: HostSession = {
  id: "hs1",
  host: U.lumi,
  kind: "world",
  client: "launcher",
  slot: 1,
  address: "relay.axolite.cc:41237",
  mcVersion: "1.21.4",
  status: "online",
  players: [
    { name: "Lumi_Builds", uuid: U.lumi.id, joinedAt: min(48) },
    { name: "Nordlicht", uuid: U.nord.id, joinedAt: min(30) },
    { name: "Fjordwal", uuid: U.fjord.id, joinedAt: min(12) },
  ],
  maxPlayers: 8,
  startedAt: min(48),
  onlineAt: min(47),
  endedAt: null,
  endReason: null,
};

const inviteWorld: Invite = {
  id: "inv1",
  kind: "world",
  from: U.lumi,
  toUserId: ME.id,
  chatId: "c-lumi",
  target: { name: "Insel-Survival", mcVersion: "1.21.4", loader: "fabric", instanceName: "Insel-Survival" },
  message: "Wir sind gerade beim Hafen, komm vorbei!",
  hostSessionId: "hs1",
  status: "pending",
  myResponse: null,
  createdAt: min(6),
  expiresAt: new Date(NOW + 54 * 60_000).toISOString(),
};
let invites: Invite[] = [inviteWorld];

// ------------------------------------------------------------------ Chats + Nachrichten

let seq = 1000;
const nextId = () => String(++seq);
const member = (u: PublicUser, role: ChatMember["role"] = "member", read: string | null = null): ChatMember => ({ user: u, role, joinedAt: min(60 * 24 * 40), lastReadMessageId: read });

function msg(chatId: string, author: PublicUser | null, content: string, at: number, extra: Partial<Message> = {}): Message {
  return { id: nextId(), chatId, authorId: author?.id ?? null, kind: "text", content, system: null, invite: null, replyToId: null, nonce: null, createdAt: min(at), editedAt: null, deleted: false, ...extra };
}
const card = (c: Omit<InviteCard, "expiresAt"> & { expiresInMin: number }): InviteCard => ({
  inviteId: c.inviteId,
  kind: c.kind,
  title: c.title,
  subtitle: c.subtitle,
  packCode: c.packCode,
  expiresAt: new Date(NOW + c.expiresInMin * 60_000).toISOString(),
});

const history: Record<string, Message[]> = {
  "c-lumi": [
    msg("c-lumi", U.lumi, "Hey! Bist du heute Abend online?", 60 * 26),
    msg("c-lumi", ME, "Klar, so ab 20 Uhr", 60 * 26 - 3),
    msg("c-lumi", ME, "Was baut ihr gerade?", 60 * 26 - 3),
    msg("c-lumi", U.lumi, "Einen Hafen mit Leuchtturm 🏝️ – Nordlicht macht die Docks", 60 * 26 - 5),
    msg("c-lumi", U.lumi, "Ich schick dir gleich eine Einladung", 9),
    { ...msg("c-lumi", U.lumi, "Wir sind gerade beim Hafen, komm vorbei!", 6), kind: "invite", invite: card({ inviteId: "inv1", kind: "world", title: "Insel-Survival", subtitle: "1.21.4 · Fabric · 3 Spieler", packCode: null, expiresInMin: 54 }) },
    msg("c-lumi", U.lumi, "🎉", 5),
  ],
  "c-kai": [
    msg("c-kai", ME, "Wie läuft Create bei dir?", 60 * 3),
    msg("c-kai", U.kai, "Super! Hab endlich die Messing-Produktion automatisiert", 60 * 3 - 2),
    msg("c-kai", U.kai, "Ich hab das Pack mit ein paar Quality-of-Life-Mods erweitert. Willst du's ausprobieren?", 60 * 3 - 2),
    msg("c-kai", ME, "Gerne, schick rüber 🙌", 60 * 3 - 4),
    {
      ...msg("c-kai", U.kai, "Hier, sollte direkt laufen. Speicher mindestens 6 GB geben!", 60 * 3 - 6),
      kind: "invite",
      invite: card({ inviteId: "inv-pack", kind: "modpack", title: "Kais Create-Pack", subtitle: "1.20.1 · Forge · 142 Mods", packCode: "KAICREATE", expiresInMin: 60 * 24 * 6 }),
    },
    msg("c-kai", ME, "Danke! Lade gerade 👍", 60 * 3 - 8),
  ],
  "c-group": [
    { ...msg("c-group", null, "", 60 * 24 * 3), kind: "system", system: { event: "chat_created", actorId: U.mira.id, name: "Freitagsrunde" } },
    msg("c-group", U.mira, "Freitag wieder Bedwars? 🛏️", 60 * 24 * 3 - 1),
    msg("c-group", U.toast, "bin dabei", 60 * 24 * 3 - 4),
    msg("c-group", U.kai, "Ich auch, aber erst ab 21 Uhr", 60 * 24 * 3 - 9),
    msg("c-group", ME, "Passt, ich hoste dann den Server", 60 * 24 * 3 - 12),
    msg("c-group", U.mira, "Wer bringt Snacks mit? 😄", 40),
    msg("c-group", U.toast, "Ich hab noch Chips", 38),
    msg("c-group", U.toast, "und Mate", 38),
    msg("c-group", U.kai, "Legende", 35),
  ],
  "c-toast": [msg("c-toast", U.toast, "Hast du meine Diamantspitzhacke gesehen? 👀", 14)],
  "c-bau": [
    msg("c-bau", U.bau, "Danke nochmal für die Hilfe beim Dach!", 60 * 24 * 5),
    msg("c-bau", ME, "Gern geschehen, sieht richtig gut aus", 60 * 24 * 5 - 30),
  ],
};

const chatMeta: Record<string, { type: Chat["type"]; name: string | null; owner: string | null; members: ChatMember[]; unread: number }> = {
  "c-lumi": { type: "dm", name: null, owner: null, members: [member(ME), member(U.lumi)], unread: 3 },
  "c-kai": { type: "dm", name: null, owner: null, members: [member(ME), member(U.kai)], unread: 0 },
  "c-group": { type: "group", name: "Freitagsrunde", owner: U.mira.id, members: [member(U.mira, "owner"), member(ME), member(U.toast), member(U.kai)], unread: 3 },
  "c-toast": { type: "dm", name: null, owner: null, members: [member(ME), member(U.toast)], unread: 1 },
  "c-bau": { type: "dm", name: null, owner: null, members: [member(ME), member(U.bau)], unread: 0 },
};
// Gelesen-Stand: Kai hat alles gelesen
chatMeta["c-kai"].members[1].lastReadMessageId = history["c-kai"].at(-1)!.id;

function chat(id: string): Chat {
  const m = chatMeta[id];
  const h = history[id];
  const last = h.at(-1) ?? null;
  return { id, type: m.type, name: m.name, ownerId: m.owner, members: m.members, lastMessage: last, unreadCount: m.unread, createdAt: h[0]?.createdAt ?? iso(), updatedAt: last?.createdAt ?? iso() };
}

const pack: Pack = {
  id: "p1",
  code: "KAICREATE",
  url: "https://vibe.mock/p/KAICREATE",
  deepLink: "vibelauncher://pack/KAICREATE",
  name: "Kais Create-Pack",
  description: "Create: Above & Beyond mit Quality-of-Life-Mods",
  owner: U.kai,
  visibility: "friends",
  mcVersion: "1.20.1",
  loader: "forge",
  iconUrl: "https://cdn.modrinth.com/data/LNytGWDc/61d716699bcf1ec42ed4926a9e1c7311be6087e2_96.webp",
  downloads: 7,
  latestVersion: { id: "pv1", version: "1.3", changelog: null, mcVersion: "1.20.1", loader: "forge", loaderVersion: "47.3.0", fileCount: 142, overrides: null, createdAt: min(200), },
  status: "active",
  createdAt: min(60 * 24 * 10),
  updatedAt: min(200),
};

// ------------------------------------------------------------------ Gateway

let wsId: string | null = null;
let evSeq = 0;
function wsSend(data: unknown) {
  if (wsId) void emit("vibe://ws", { type: "message", id: wsId, data: JSON.stringify(data) });
}
function gwEvent(t: string, d: unknown) {
  wsSend({ op: "event", t, d, s: ++evSeq });
}

function startTypingLoop() {
  // Lumi tippt ab und zu im DM, die Freitagsrunde gelegentlich auch
  setInterval(() => {
    gwEvent("typing", { chatId: "c-lumi", userId: U.lumi.id, until: new Date(Date.now() + 6000).toISOString() });
  }, 14_000);
  setTimeout(() => gwEvent("typing", { chatId: "c-group", userId: U.toast.id, until: new Date(Date.now() + 8000).toISOString() }), 2500);
}

/** Antwort eines Freundes nach eigener Nachricht (Tippen, dann Nachricht). */
function autoReply(chatId: string) {
  const other = chatMeta[chatId]?.members.find((m) => m.user.id !== ME.id)?.user;
  if (!other) return;
  setTimeout(() => gwEvent("typing", { chatId, userId: other.id, until: new Date(Date.now() + 4000).toISOString() }), 700);
  setTimeout(() => {
    const replies = ["😄", "Klingt gut!", "Bin gleich da", "Haha, genau", "👍"];
    const m = { ...msg(chatId, other, replies[Math.floor(Math.random() * replies.length)], 0), createdAt: iso() };
    history[chatId].push(m);
    gwEvent("message.created", m);
  }, 3200);
}

// ------------------------------------------------------------------ REST

type Res = { status: number; body?: unknown };
const ok = (body: unknown): Res => ({ status: 200, body });
const none: Res = { status: 204 };
const notFound: Res = { status: 404, body: { error: { code: "not_found", message: "Nicht gefunden" } } };

function relationship(u: PublicUser): UserWithRelationship["relationship"] {
  if (u.id === ME.id) return "self";
  if (friends.has(u.id)) return "friend";
  if (blocked.some((b) => b.id === u.id)) return "blocked";
  const r = requests.find((x) => x.from.id === u.id || x.to.id === u.id);
  return r ? (r.direction === "incoming" ? "incoming" : "outgoing") : "none";
}

function route(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Res {
  const rel = path.replace(/^\/api\/v1\//, "");
  // Muster wie "chats/:id/messages" -> Parameter b (1.), d (2.)
  const PATTERNS = [
    "meta", "me", "presence", "presence/friends", "friends", "friends/requests", "friends/requests/:id/accept", "friends/requests/:id/decline",
    "friends/requests/:id", "friends/:id", "blocks", "blocks/:id", "users/search", "chats", "chats/dm", "chats/:id", "chats/:id/messages",
    "chats/:id/messages/:id", "chats/:id/members", "chats/:id/members/:id", "chats/:id/read", "chats/:id/typing", "invites", "invites/:id/accept",
    "invites/:id/decline", "invites/:id", "hosting/friends", "hosting/limits", "hosting/sessions", "packs/mine", "packs/:id", "packs/:id/versions",
    "notifications",
  ];
  let b = "";
  let d = "";
  let pat = "?";
  for (const pt of PATTERNS) {
    const re = new RegExp("^" + pt.replace(/:id/g, "([^/]+)") + "$");
    const mm = rel.match(re);
    if (mm) {
      pat = pt;
      b = decodeURIComponent(mm[1] ?? "");
      d = decodeURIComponent(mm[2] ?? "");
      break;
    }
  }
  const key = `${method} ${pat}`;
  switch (key) {
    case "GET meta":
      return ok({
        name: "Vibe (Mock)",
        version: "1.0.0",
        apiVersion: 1,
        motd: null,
        features: { registration: true, chat: true, sharing: true, hosting: true, invites: true },
        limits: { chatMessageMaxLength: 2000, maxGroupMembers: 10 },
        publicUrl: API,
      } satisfies ServerMeta);
    case "GET me":
      return ok(ME);
    case "PATCH me":
      Object.assign(ME, body);
      return ok(ME);
    case "PUT presence":
      if (body.status) ME.presenceStatus = body.status as Me["presenceStatus"];
      return ok({ userId: ME.id, status: ME.presenceStatus === "invisible" ? "offline" : ME.presenceStatus, activity: null, updatedAt: iso() });
    case "GET friends":
      return ok([...friends.values()]);
    case "GET friends/requests":
      return ok(requests);
    case "POST friends/requests": {
      const target = Object.values(U).find((u) => u.id === body.userId || u.name.toLowerCase() === String(body.name ?? "").toLowerCase());
      if (!target) return { status: 404, body: { error: { code: "user_not_found", message: "Diesen Spieler gibt es bei Vibe noch nicht." } } };
      const r: FriendRequest = { id: "rq" + nextId(), from: ME, to: target, createdAt: iso(), direction: "outgoing" };
      requests = [...requests, r];
      return ok({ status: "pending", request: r, friend: null });
    }
    case "POST friends/requests/:id/accept": {
      const r = requests.find((x) => x.id === b);
      if (!r) return notFound;
      requests = requests.filter((x) => x.id !== b);
      const f: Friend = { user: r.from, since: iso(), presence: presence(r.from, "online", { type: "launcher" }) };
      friends.set(f.user.id, f);
      setTimeout(() => gwEvent("friend.added", f), 100);
      return ok(f);
    }
    case "POST friends/requests/:id/decline":
    case "DELETE friends/requests/:id":
      requests = requests.filter((x) => x.id !== b);
      return none;
    case "DELETE friends/:id":
      friends.delete(b);
      return none;
    case "GET blocks":
      return ok(blocked);
    case "PUT blocks/:id": {
      const u = Object.values(U).find((x) => x.id === b);
      if (u) blocked = [...blocked, u];
      friends.delete(b);
      return none;
    }
    case "DELETE blocks/:id":
      blocked = blocked.filter((x) => x.id !== b);
      return none;
    case "GET users/search": {
      const q = (query.get("q") ?? "").toLowerCase();
      return ok(
        Object.values(U)
          .filter((u) => u.name.toLowerCase().includes(q))
          .slice(0, Number(query.get("limit") ?? 8))
          .map((u) => ({ ...u, relationship: relationship(u) })),
      );
    }
    case "GET chats":
      return ok(Object.keys(chatMeta).map(chat));
    case "GET chats/:id":
      return chatMeta[b] ? ok(chat(b)) : notFound;
    case "POST chats/dm": {
      const existing = Object.keys(chatMeta).find((id) => chatMeta[id].type === "dm" && chatMeta[id].members.some((m) => m.user.id === body.userId));
      if (existing) return ok(chat(existing));
      const u = friends.get(String(body.userId))?.user;
      if (!u) return notFound;
      const id = "c-" + nextId();
      chatMeta[id] = { type: "dm", name: null, owner: null, members: [member(ME), member(u)], unread: 0 };
      history[id] = [];
      return ok(chat(id));
    }
    case "POST chats": {
      const id = "c-" + nextId();
      const members = [member(ME, "owner"), ...((body.memberIds as string[]) ?? []).map((x) => friends.get(x)?.user).filter((u): u is PublicUser => !!u).map((u) => member(u))];
      chatMeta[id] = { type: "group", name: String(body.name ?? "Gruppe"), owner: ME.id, members, unread: 0 };
      history[id] = [{ ...msg(id, null, "", 0), createdAt: iso(), kind: "system", system: { event: "chat_created", actorId: ME.id, name: String(body.name ?? "") } }];
      return ok(chat(id));
    }
    case "PATCH chats/:id":
      if (body.name) chatMeta[b].name = String(body.name);
      setTimeout(() => gwEvent("chat.updated", chat(b)), 50);
      return ok(chat(b));
    case "DELETE chats/:id/members/:id":
      return none;
    case "GET chats/:id/messages": {
      const all = history[b] ?? [];
      const before = query.get("before");
      const limit = Number(query.get("limit") ?? 50);
      const end = before ? all.findIndex((m) => m.id === before) : all.length;
      const slice = all.slice(Math.max(0, end - limit), end);
      return ok({ messages: slice.reverse(), hasMore: end - limit > 0 });
    }
    case "POST chats/:id/messages": {
      const m: Message = { ...msg(b, ME, String(body.content ?? ""), 0), nonce: (body.nonce as string) ?? null, createdAt: iso() };
      history[b] = [...(history[b] ?? []), m];
      autoReply(b);
      return ok(m);
    }
    case "PATCH chats/:id/messages/:id": {
      const m = history[b]?.find((x) => x.id === d);
      if (!m) return notFound;
      m.content = String(body.content ?? "");
      m.editedAt = iso();
      setTimeout(() => gwEvent("message.updated", m), 50);
      return ok(m);
    }
    case "DELETE chats/:id/messages/:id": {
      const m = history[b]?.find((x) => x.id === d);
      if (m) {
        m.deleted = true;
        setTimeout(() => gwEvent("message.deleted", { chatId: b, messageId: d }), 50);
      }
      return none;
    }
    case "POST chats/:id/read":
      if (chatMeta[b]) chatMeta[b].unread = 0;
      return none;
    case "POST chats/:id/typing":
      return none;
    case "GET invites":
      return ok(query.get("direction") === "outgoing" ? [] : invites);
    case "POST invites":
      return ok([]);
    case "POST invites/:id/accept": {
      const inv = invites.find((x) => x.id === b);
      invites = invites.filter((x) => x.id !== b);
      if (b === "inv-pack") return ok({ invite: { ...inviteWorld, id: b, kind: "modpack", status: "accepted" }, connection: null, packCode: "KAICREATE" });
      return ok({ invite: { ...(inv ?? inviteWorld), status: "accepted" }, connection: { type: "relay", address: "relay.axolite.cc", port: 41237 }, packCode: null });
    }
    case "POST invites/:id/decline":
      invites = invites.filter((x) => x.id !== b);
      return ok({ ...inviteWorld, status: "declined" });
    case "GET hosting/friends":
      return ok([hostLumi]);
    case "GET hosting/limits":
      return ok({ enabled: true, maxHosts: 2, maxPlayersPerHost: 8, active: 0 });
    case "GET hosting/sessions":
      return ok([]);
    case "GET packs/mine":
      return ok([]);
    case "GET packs/:id":
      return b === "KAICREATE" ? ok(pack) : notFound;
    case "GET packs/:id/versions":
      return ok(pack.latestVersion ? [pack.latestVersion] : []);
    case "GET notifications":
      return ok({ notifications: [], unreadCount: 0 });
    case "GET presence/friends":
      return ok([...friends.values()].map((f) => f.presence));
    default:
      console.warn("[mock vibe] nicht simuliert:", method, path, key);
      return notFound;
  }
}

// ------------------------------------------------------------------ IPC-Handler

// Screenshots: localStorage vl.mock.vibeauth = "0" -> bei Vibe abgemeldet
const loggedOut = (() => {
  try {
    return localStorage.getItem("vl.mock.vibeauth") === "0";
  } catch {
    return false;
  }
})();
let tokens: VibeTokens | null = loggedOut
  ? null
  : { accessToken: "mock-access", refreshToken: "mock-refresh", expiresAt: Date.now() + 365 * 86400_000, sessionId: "mock-session" };

const handlers: Handlers = {
  vibe_status: (): VibeStatus => ({
    enabled: true,
    api_url: API,
    gateway_url: API.replace(/^http/, "ws") + "/ws",
    identity: { scope: "a1", name: ME.name, uuid: ME.id, dev: false },
    logged_in: !!tokens,
  }),
  vibe_tokens_get: () => tokens,
  vibe_tokens_set: ({ tokens: t }) => {
    tokens = (t as VibeTokens | null) ?? null;
    return null;
  },
  vibe_mojang_join: () => ({ name: ME.name, uuid: ME.id }),
  vibe_http: async ({ request }): Promise<VibeHttpResponse> => {
    const r = request as VibeHttpRequest;
    const url = new URL(r.url);
    let body: Record<string, unknown> = {};
    try {
      body = r.body ? JSON.parse(r.body) : {};
    } catch {
      /* egal */
    }
    await new Promise((res) => setTimeout(res, 60 + Math.random() * 120));
    const res = route(r.method, url.pathname, url.searchParams, body);
    return { status: res.status, body: res.body === undefined ? "" : JSON.stringify(res.body), content_type: "application/json", retry_after: null };
  },
  vibe_ws_open: ({ id }) => {
    wsId = id as string;
    setTimeout(() => {
      void emit("vibe://ws", { type: "open", id });
      wsSend({ op: "hello", d: { heartbeatInterval: 40_000 } });
    }, 80);
    return null;
  },
  vibe_ws_send: ({ id, data }) => {
    if (id !== wsId) return null;
    const m = JSON.parse(String(data)) as { op: string; d?: Record<string, unknown> };
    if (m.op === "identify") {
      setTimeout(() => {
        wsSend({ op: "ready", d: { sessionId: "gw-mock", heartbeatInterval: 40_000, user: ME, friends: [...friends.values()], features: { chat: true, hosting: true, sharing: true, invites: true } } });
        startTypingLoop();
      }, 120);
    } else if (m.op === "ping") wsSend({ op: "pong", d: {} });
    return null;
  },
  vibe_ws_close: ({ id, code }) => {
    if (id === wsId) {
      void emit("vibe://ws", { type: "close", id, code: code ?? 1000, reason: "" });
      wsId = null;
    }
    return null;
  },
  vibe_pack_link: () => null,
};

export default handlers;
