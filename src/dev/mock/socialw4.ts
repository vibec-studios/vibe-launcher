// Mock Welle 4: Pack folgen + Diff, Spiel-Link mit Vibe-Pack, Hosting-Panel, Beta-Einladungen.
// Testwege: Instanz „Insel-Survival“ (gefolgtes Pack mit Update) · `?join=insel2` (Link mit Vibe-Pack, Update) ·
// `?join=inselx` (neu anlegen) · `?invite=k3x9q2ab` (Beta-Einladung) · `?running=survival` (Hosten → Pack anhängen, Verwalten)
import type { Instance, JoinPreview, PlayLink } from "@/lib/types";
import type {
  AccessInvite,
  HostMember,
  HostPanel,
  HostPlayer,
  HostSession,
  HostSessionEvent,
  Pack,
  PackDiff,
  PackDiffEntry,
  PackFollow,
  PackVersion,
  PublicUser,
} from "@/lib/vibe-sdk";
import { instances } from "./core";
import play from "./play";
import packupdate from "./packupdate";
import { approveByInvite } from "./access";
import { gwEvent } from "./social";
import { fakeTask, mockEmit, type Handlers } from "./util";

const NOW = Date.now();
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const iso = () => new Date().toISOString();

function user(id: string, name: string, skin: string): PublicUser {
  return { id, name, skin: { url: `https://mc-heads.net/skin/${skin}`, model: "classic", capeUrl: null }, statusText: null, badge: "user", createdAt: ago(60 * 24 * 100) };
}
const ME = user("069a79f4-44e9-4726-a5be-fca90e38aaf5", "Henny", "069a79f444e94726a5befca90e38aaf5");
const LUMI = user("a1b2c3d4-0000-4000-8000-000000000001", "Lumi_Builds", "jeb_");
const KAI = user("a1b2c3d4-0000-4000-8000-000000000002", "KaiCraft", "TommyInnit");
const MIRA = user("a1b2c3d4-0000-4000-8000-000000000003", "mira_px", "LDShadowLady");

// ------------------------------------------------------------------ Packs

const v12: PackVersion = { id: "pv-12", version: "1.2.0", changelog: null, mcVersion: "1.21.1", loader: "fabric", loaderVersion: "0.16.9", fileCount: 96, overrides: null, createdAt: ago(60 * 24 * 6) };
const v13: PackVersion = {
  id: "pv-13",
  version: "1.3.0",
  changelog: "Create 6 ist da! Dazu Farmer's Delight, eine neue Minimap und aktualisierte Shader-Einstellungen.\nXaero's Minimap fliegt raus (Journeymap ersetzt sie).",
  mcVersion: "1.21.1",
  loader: "fabric",
  loaderVersion: "0.16.10",
  fileCount: 98,
  overrides: { size: 1_840_000, sha256: "ab", url: "https://vibe.mock/api/v1/packs/LUMIINSEL/versions/pv-13/overrides" },
  createdAt: ago(25),
};
const lumiPack: Pack = {
  id: "p-lumi",
  code: "LUMIINSEL",
  url: "https://vibe.mock/p/LUMIINSEL",
  deepLink: "vibelauncher://pack/LUMIINSEL",
  name: "Insel-Survival",
  description: "Lumis Survival-Pack für die Insel-Runde",
  owner: LUMI,
  visibility: "friends",
  mcVersion: "1.21.1",
  loader: "fabric",
  iconUrl: "https://cdn.modrinth.com/data/LNytGWDc/61d716699bcf1ec42ed4926a9e1c7311be6087e2_96.webp",
  downloads: 9,
  latestVersion: v13,
  status: "active",
  createdAt: ago(60 * 24 * 30),
  updatedAt: ago(25),
  followers: 4,
  following: true,
};
const ownPack: Pack = { ...lumiPack, id: "p-own", code: "HENNYSURV", url: "https://vibe.mock/p/HENNYSURV", deepLink: "vibelauncher://pack/HENNYSURV", name: "Survival 1.21", owner: ME, latestVersion: { ...v12, id: "pv-own-3", version: "3.0.0" }, followers: 2, following: false };

let follows: PackFollow[] = [{ pack: lumiPack, notify: true, installedVersionId: "pv-12", updateAvailable: true, followedAt: ago(60 * 24 * 6), updatedAt: ago(25) }];

{
  const base = instances.get("survival")!;
  const insel: Instance = {
    ...base,
    id: "insel",
    name: "Insel-Survival",
    mc_version: "1.21.1",
    loader: { kind: "fabric", version: "0.16.9" },
    icon: "block:grass@sunset",
    accent: "#ffb347",
    last_played: NOW - 86400_000,
    source: { kind: "vibe", project_id: "LUMIINSEL", version_id: "pv-12", name: "Insel-Survival", version_name: "1.2.0" },
  };
  instances.set(insel.id, insel);
}

function entry(path: string, category: PackDiffEntry["category"], pid: string | null, vid: string): PackDiffEntry {
  return { path, source: pid ? "modrinth" : "override", project_id: pid, version_id: vid, url: "https://cdn.modrinth.com/x", sha1: null, size: 1_000_000, key: pid ? `modrinth:${pid}` : path, category };
}

const diff: PackDiff = {
  from: v12,
  to: v13,
  mcVersion: null,
  loader: { from: { kind: "fabric", version: "0.16.9" }, to: { kind: "fabric", version: "0.16.10" } },
  added: [entry("mods/farmersdelight-fabric-1.21.1-3.0.jar", "mod", "R2OftAxM", "fd3"), entry("mods/journeymap-1.21.1-6.0.0.jar", "mod", "lfHFW1mp", "jm6"), entry("resourcepacks/FreshAnimations_v1.9.zip", "resourcepack", "50dA9Sha", "fa19")],
  removed: [entry("mods/Xaeros_Minimap_24.6_Fabric_1.21.jar", "mod", "1bokaNcj", "xm246")],
  updated: [
    { ...entry("mods/create-fabric-6.0.4.jar", "mod", "LNytGWDc", "c604"), previous: { path: "mods/create-fabric-0.5.1.jar", source: "modrinth", project_id: "LNytGWDc", version_id: "c051", url: "", sha1: null, size: null } },
    { ...entry("mods/sodium-fabric-0.6.5.jar", "mod", "AANobbMI", "s065"), previous: { path: "mods/sodium-fabric-0.6.3.jar", source: "modrinth", project_id: "AANobbMI", version_id: "s063", url: "", sha1: null, size: null } },
    { ...entry("shaderpacks/ComplementaryReimagined_r5.4.zip", "shader", "HVnmMxH1", "cr54"), previous: { path: "shaderpacks/ComplementaryReimagined_r5.3.zip", source: "modrinth", project_id: "HVnmMxH1", version_id: "cr53", url: "", sha1: null, size: null } },
    { ...entry("config/sodium-options.json", "config", null, "-"), previous: { path: "config/sodium-options.json", source: "override", project_id: null, version_id: null, url: "", sha1: "a", size: 900 } },
  ],
  overridesChanged: true,
  summary: { added: 3, removed: 1, updated: 4, unchanged: 89 },
};

// ------------------------------------------------------------------ Hosting

const session: HostSession = {
  id: "hs-1",
  host: ME,
  kind: "world",
  client: "mod",
  slot: 0,
  address: "mossy-otter-27.axolite.cc",
  worldName: "Neue Welt",
  mcVersion: "1.21.4",
  status: "online",
  players: [],
  maxPlayers: 8,
  startedAt: ago(40),
  onlineAt: ago(39),
  endedAt: null,
  endReason: null,
  privacy: "friends",
  myRole: "host",
  pack: null,
};
let players: HostPlayer[] = [
  { name: LUMI.name, uuid: LUMI.id, joinedAt: ago(31) },
  { name: KAI.name, uuid: KAI.id, joinedAt: ago(12) },
];
let members: HostMember[] = [{ uuid: LUMI.id, name: LUMI.name, role: "member", user: LUMI, addedAt: ago(60 * 24 * 3) }];
let kicks: HostPanel["kicks"] = [{ uuid: null, name: "Spamkönig", reason: "Spam im Chat", permanent: true, at: ago(60 * 24) }];
let policy: HostPanel["policy"] = { privacy: "friends", defaultRole: "guest", maxPlayers: null };
let evSeq = 0;
const ev = (type: HostSessionEvent["type"], player: { uuid: string | null; name: string } | null, minutes: number, data: Record<string, unknown> | null = null, actor: PublicUser | null = null): HostSessionEvent => ({
  id: `he-${++evSeq}`,
  sessionId: session.id,
  type,
  actor,
  player,
  data,
  at: minutes ? ago(minutes) : iso(),
});
let events: HostSessionEvent[] = [
  ev("join", { uuid: KAI.id, name: KAI.name }, 12),
  ev("denied", { uuid: null, name: "Spamkönig" }, 20, { code: "kicked" }),
  ev("role", { uuid: LUMI.id, name: LUMI.name }, 28, { role: "member" }, ME),
  ev("join", { uuid: LUMI.id, name: LUMI.name }, 31),
  ev("privacy", null, 38, { privacy: "friends" }, ME),
];

const roleOf = (uuid: string | null, name: string) => members.find((m) => m.uuid === uuid || m.name.toLowerCase() === name.toLowerCase())?.role ?? policy.defaultRole;
const panel = (): HostPanel => ({
  session: { ...session, privacy: policy.privacy, players },
  policy,
  members,
  kicks,
  players: players.map((p) => ({ ...p, role: roleOf(p.uuid, p.name) })),
  myRole: "host",
});
function pushEvent(e: HostSessionEvent) {
  events = [e, ...events].slice(0, 200);
  gwEvent("hosting.event", e);
}
function panelChanged() {
  gwEvent("hosting.panel.updated", { sessionId: session.id, policy, members, kicks });
}
const findPlayer = (p: string) => players.find((x) => x.uuid === p || x.name.toLowerCase() === p.toLowerCase());

setInterval(() => {
  const here = players.some((p) => p.uuid === MIRA.id);
  if (here) {
    players = players.filter((p) => p.uuid !== MIRA.id);
    pushEvent(ev("leave", { uuid: MIRA.id, name: MIRA.name }, 0));
  } else {
    players = [...players, { name: MIRA.name, uuid: MIRA.id, joinedAt: iso() }];
    pushEvent(ev("join", { uuid: MIRA.id, name: MIRA.name }, 0));
  }
}, 18_000);

setTimeout(() => gwEvent("pack.version.published", { pack: lumiPack, version: v13, previousVersionId: "pv-12", summary: diff.summary }), 9_000);

// ------------------------------------------------------------------ Beta-Einladungen

const ALPHA = "23456789abcdefghjkmnpqrstuvwxyz";
const newCode = () => Array.from({ length: 8 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join("");
const inviteOf = (code: string, extra: Partial<AccessInvite> = {}): AccessInvite => ({
  id: `ai-${code}`,
  code,
  url: `https://axolite.cc/i/${code}`,
  deepLink: `vibelauncher://invite/${code}`,
  name: null,
  status: "pending",
  redeemedBy: null,
  createdAt: ago(60 * 24),
  expiresAt: new Date(NOW + 13 * 86400_000).toISOString(),
  redeemedAt: null,
  ...extra,
});
let invites: AccessInvite[] = [inviteOf("k3x9q2ab"), inviteOf("m7w4r8tz", { status: "redeemed", name: "KaiCraft", redeemedBy: KAI, redeemedAt: ago(60 * 20) })];
const LIMIT = 3;
const used = () => invites.filter((i) => i.status === "pending" || i.status === "redeemed").length;

// ------------------------------------------------------------------ REST

let inviteTaken = false;

type Res = { status: number; body?: unknown };
const ok = (body: unknown): Res => ({ status: 200, body });
const err = (status: number, code: string, message: string): Res => ({ status, body: { error: { code, message } } });
const none: Res = { status: 204 };

export function w4Route(method: string, rel: string, query: URLSearchParams, body: Record<string, unknown>): Res | null {
  const m = (re: RegExp) => rel.match(re);
  let x: RegExpMatchArray | null;
  if (rel === "packs/following" && method === "GET") return ok(follows);
  if ((x = m(/^packs\/([^/]+)\/follow$/))) {
    const code = decodeURIComponent(x[1]).toUpperCase();
    const cur = follows.find((f) => f.pack.code === code);
    if (method === "GET") return cur ? ok(cur) : err(404, "not_found", "Kein Abo");
    if (method === "DELETE") {
      follows = follows.filter((f) => f.pack.code !== code);
      return none;
    }
    if (method === "PUT") {
      if (code === ownPack.code) return err(400, "bad_request", "Eigenes Pack");
      const pack = code === lumiPack.code ? lumiPack : null;
      if (!pack) return err(404, "not_found", "Pack nicht gefunden");
      const installed = body.installedVersionId !== undefined ? ((body.installedVersionId as string | null) ?? null) : (cur?.installedVersionId ?? null);
      const f: PackFollow = {
        pack,
        notify: typeof body.notify === "boolean" ? body.notify : (cur?.notify ?? true),
        installedVersionId: installed,
        updateAvailable: !!pack.latestVersion && pack.latestVersion.id !== installed,
        followedAt: cur?.followedAt ?? iso(),
        updatedAt: iso(),
      };
      follows = [f, ...follows.filter((y) => y.pack.code !== code)];
      return ok(f);
    }
  }
  if ((x = m(/^packs\/([^/]+)\/diff$/)) && method === "GET") {
    const from = query.get("from");
    if (from !== "pv-12") return err(404, "not_found", "Version nicht gefunden");
    return ok(diff);
  }
  if ((x = m(/^packs\/([^/]+)$/)) && method === "GET") {
    const code = decodeURIComponent(x[1]).toUpperCase();
    if (code === lumiPack.code) return ok(lumiPack);
    if (code === ownPack.code) return ok(ownPack);
    return null;
  }

  if (rel === "hosting/sessions" && method === "GET") return ok([{ ...session, privacy: policy.privacy, players }]);
  if ((x = m(/^hosting\/sessions\/([^/]+)(\/.*)?$/))) {
    if (x[1] !== session.id) return err(404, "not_found", "Session nicht gefunden");
    const sub = x[2] ?? "";
    if (sub === "/panel" && method === "GET") return ok(panel());
    if (sub === "/events" && method === "GET") return ok({ events });
    if (sub === "/policy" && method === "PATCH") {
      const before = policy.privacy;
      policy = { ...policy, ...(body as Partial<HostPanel["policy"]>) };
      if (policy.privacy !== before) pushEvent(ev("privacy", null, 0, { privacy: policy.privacy }, ME));
      panelChanged();
      return ok(panel());
    }
    if (sub === "/kick" && method === "POST") {
      const p = String(body.player ?? "");
      const pl = findPlayer(p);
      const name = pl?.name ?? p;
      players = players.filter((y) => y !== pl);
      kicks = [{ uuid: pl?.uuid ?? null, name, reason: (body.reason as string) ?? null, permanent: !!body.permanent, at: iso() }, ...kicks.filter((k) => k.name !== name)];
      pushEvent(ev("kick", { uuid: pl?.uuid ?? null, name }, 0, { permanent: !!body.permanent, reason: body.reason ?? null }, ME));
      panelChanged();
      return ok(panel());
    }
    if ((x = sub.match(/^\/kicks\/(.+)$/)) && method === "DELETE") {
      const p = decodeURIComponent(x[1]);
      const k = kicks.find((y) => y.uuid === p || y.name.toLowerCase() === p.toLowerCase());
      kicks = kicks.filter((y) => y !== k);
      if (k) pushEvent(ev("unkick", { uuid: k.uuid, name: k.name }, 0, null, ME));
      panelChanged();
      return ok(panel());
    }
    if ((x = sub.match(/^\/members\/(.+)$/))) {
      const p = decodeURIComponent(x[1]);
      const existing = members.find((y) => y.uuid === p || y.name.toLowerCase() === p.toLowerCase());
      const pl = findPlayer(p);
      if (method === "PUT") {
        const role = body.role as "member" | "guest";
        const name = (body.name as string) || existing?.name || pl?.name || p;
        const uuid = existing?.uuid ?? pl?.uuid ?? `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`;
        members = [{ uuid, name, role, user: existing?.user ?? null, addedAt: existing?.addedAt ?? iso() }, ...members.filter((y) => y !== existing)];
        pushEvent(ev("role", { uuid, name }, 0, { role }, ME));
      } else if (method === "DELETE") {
        members = members.filter((y) => y !== existing);
        if (existing) pushEvent(ev("role", { uuid: existing.uuid, name: existing.name }, 0, { role: null }, ME));
      }
      panelChanged();
      return ok(panel());
    }
    if (sub === "" && method === "PATCH") return ok(session);
  }

  if ((x = m(/^play-links\/([^/]+)$/)) && method === "GET") {
    const code = decodeURIComponent(x[1]);
    return ok({ ...(play.play_link_get({ code }) as PlayLink), code, url: `https://axolite.cc/j/${code}`, vibe_pack: code === "w4pack" ? linkPack() : null });
  }
  if (rel === "play-links" && method === "POST") {
    return { status: 201, body: { code: "w4pack", url: "https://axolite.cc/j/w4pack", expires_at: new Date(Date.now() + 11 * 3600_000).toISOString() } };
  }

  if (rel === "access-invites" && method === "GET") return ok({ enabled: true, limit: LIMIT, used: used(), remaining: Math.max(0, LIMIT - used()), invites });
  if (rel === "access-invites" && method === "POST") {
    if (used() >= LIMIT) return err(403, "limit_reached", "Kontingent erreicht");
    const name = typeof body.name === "string" ? body.name : null;
    if (name && name.toLowerCase() === ME.name.toLowerCase()) return err(400, "bad_request", "Eigener Name");
    const inv = inviteOf(newCode(), { name, createdAt: iso(), status: name === "mira_px" ? "redeemed" : "pending", redeemedBy: name === "mira_px" ? MIRA : null });
    invites = [inv, ...invites];
    return { status: 201, body: inv };
  }
  if ((x = m(/^access-invites\/([^/]+)$/)) && method === "DELETE") {
    invites = invites.map((i) => (i.id === x![1] ? { ...i, status: "revoked" as const } : i));
    return none;
  }
  if ((x = m(/^access\/invites\/([^/]+)$/)) && method === "GET") {
    const code = decodeURIComponent(x[1]).toLowerCase();
    inviteTaken = true;
    if (code === "zzzzzzzz") return err(404, "not_found", "Unbekannt");
    const expired = code === "exp23456";
    return ok({ code, inviter: { uuid: LUMI.id, name: LUMI.name }, name: null, valid: !expired, status: expired ? "expired" : "pending", expiresAt: new Date(NOW + 9 * 86400_000).toISOString() });
  }
  if (rel === "access/redeem" && method === "POST") {
    const code = String(body.code ?? "").toLowerCase();
    if (code === "zzzzzzzz") return err(404, "not_found", "Unbekannt");
    if (code === "exp23456") return err(410, "gone", "Abgelaufen");
    return ok(approveByInvite());
  }
  return null;
}

// ------------------------------------------------------------------ Tauri-Handler

function linkPack() {
  return {
    code: lumiPack.code,
    version_id: v13.id,
    version: v13.version,
    name: lumiPack.name,
    icon_url: lumiPack.iconUrl,
    mc_version: "1.21.1",
    loader: "fabric",
    loader_version: "0.16.10",
    file_count: 98,
    download_url: "https://vibe.mock/api/v1/play-links/insel2/pack",
    overrides_url: null,
    overrides_sha256: null,
    overrides_size: null,
    latest_version_id: v13.id,
    available: true,
  };
}

function vibeLink(code: string): PlayLink {
  return {
    ...(play.play_link_get({ code: "k3x9q2" }) as PlayLink),
    code,
    url: `https://axolite.cc/j/${code}`,
    host: { uuid: LUMI.id, name: LUMI.name },
    relay_host: "lumi-insel-12.axolite.cc",
    pack: null,
    mods: [],
    world_name: "Insel-Survival",
    vibe_pack: { ...linkPack(), code: code === "inselx" ? "LUMINEU" : lumiPack.code, name: code === "inselx" ? "Lumis Abenteuer" : lumiPack.name },
  };
}

function vibePreview(l: PlayLink): JoinPreview {
  const vp = l.vibe_pack!;
  const target = [...instances.values()].find((i) => i.source?.kind === "vibe" && i.source.project_id?.toUpperCase() === vp.code.toUpperCase());
  const same = target?.source?.version_id === vp.version_id;
  return {
    instance_id: target?.id ?? null,
    instance_name: target?.name ?? null,
    create: !target,
    pack_title: vp.name,
    pack_icon: vp.icon_url,
    pack_version: vp.version,
    mods: 0,
    pack_files: vp.file_count,
    client_pack: null,
    download_bytes: null,
    game_download: !target || !same,
    manual: [],
    problem: null,
    problem_detail: null,
    pack_update: !!target && !same,
    pack_from_version: target && !same ? (target.source?.version_name ?? null) : null,
    vibe_pack: true,
  };
}

const isVibeInput = (i: unknown): i is { kind: "vibe"; code: string; version_id: string | null } => (i as { kind?: string })?.kind === "vibe";

const handlers: Handlers = {
  app_actions_take: (args) => {
    const code = new URLSearchParams(location.search).get("invite");
    if (code && !inviteTaken) {
      return [{ kind: "access_invite", code }];
    }
    return play.app_actions_take(args);
  },
  vibe_pack_link: ({ instanceId }) => (instanceId === "survival" ? { code: ownPack.code, url: ownPack.url } : null),
  play_link_get: (args) => (args.code === "insel2" || args.code === "inselx" ? vibeLink(String(args.code)) : play.play_link_get(args)),
  play_join_preview: (args) => ((args.link as PlayLink).vibe_pack ? vibePreview(args.link as PlayLink) : play.play_join_preview(args)),
  play_join_setup: (args) => {
    const l = args.link as PlayLink;
    if (!l.vibe_pack) return play.play_join_setup(args);
    const target = (args.instanceId as string | null) ?? "insel";
    return fakeTask("play_join", `Einladung von ${l.host.name} vorbereiten`, target, 3500, () => {
      const i = instances.get(target);
      if (!i) return;
      const next: Instance = { ...i, source: { kind: "vibe", project_id: l.vibe_pack!.code, version_id: l.vibe_pack!.version_id, name: l.vibe_pack!.name, version_name: l.vibe_pack!.version } };
      instances.set(target, next);
      mockEmit("instance://changed", next);
    });
  },
  modpack_from_preview: async (args) => {
    if (!isVibeInput(args.input)) return packupdate.modpack_from_preview(args);
    const p = (await packupdate.modpack_from_preview({ ...args, input: { kind: "url", url: "https://x/insel.vlpack" } })) as { target: { version_number: string; id: string } };
    return { ...p, current_version: "1.2.0", target: { ...p.target, id: args.input.version_id ?? "pv-13", version_number: "1.3.0" }, loader_to: { kind: "fabric", version: "0.16.10" } };
  },
  modpack_from_update: (args) => {
    if (!isVibeInput(args.input)) return packupdate.modpack_from_update(args);
    const id = args.instanceId as string;
    const input = args.input;
    return fakeTask("update", "Modpack aktualisieren", id, 2500, () => {
      const i = instances.get(id);
      if (!i) return;
      const next: Instance = { ...i, loader: { kind: "fabric", version: "0.16.10" }, source: { ...i.source!, version_id: input.version_id ?? "pv-13", version_name: "1.3.0" } };
      instances.set(id, next);
      mockEmit("instance://changed", next);
    });
  },
};

export default handlers;
