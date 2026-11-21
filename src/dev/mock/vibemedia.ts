// Mock: Screenshots hochladen/teilen, Aktivitäten-Feed, Server entdecken, Cloud-Sicherung und Geräte-Kopplung.
// Screenshots: localStorage vl.mock.feed = "on" (Feed eingeschaltet), vl.mock.cloud = "conflict" (erstes Sichern
// liefert revision_conflict), vl.mock.discovery = "empty", vl.mock.shots.full = "1" (Kontingent fast voll).
import type { CloudSettings, CloudSnapshot, DeviceSession, DiscoveryServer, DiscoverySubmission, FeedItem, Screenshot, ScreenshotVisibility } from "@/lib/vibe-sdk";
import { instances } from "./core";
import { landscape } from "./home";
import { fakeTask, type Handlers } from "./util";

const API = "https://vibe.mock";
const ME = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
const NOW = Date.now();
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const MiB = 1024 * 1024;

function flag(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

type Res = { status: number; body?: unknown };
const ok = (body: unknown): Res => ({ status: 200, body });
const none: Res = { status: 204 };
const err = (status: number, code: string, message: string, details?: unknown): Res => ({ status, body: { error: { code, message, details } } });

let seq = 10;
const key = () => "k".repeat(11) + Math.random().toString(36).slice(2, 10).padEnd(32, "x").slice(0, 32);

function shot(id: string, visibility: ScreenshotVisibility, size: number, m: number): Screenshot {
  const k = visibility === "link" ? key() : null;
  return {
    id,
    userId: ME,
    visibility,
    contentType: "image/png",
    size,
    createdAt: ago(m),
    imagePath: `/api/v1/screenshots/${id}/image`,
    sharePath: k ? `/api/v1/screenshots/${id}/image?key=${k}` : null,
  };
}

let shots: Screenshot[] = [shot("shot-1", "friends", 2.4 * MiB, 60 * 26), shot("shot-2", "link", 1.8 * MiB, 60 * 72), shot("shot-3", "private", 3.1 * MiB, 60 * 24 * 6)];
const quota = 64 * MiB;
const usedBase = flag("vl.mock.shots.full") ? 60 * MiB : 0;
const used = () => usedBase + shots.reduce((n, s) => n + s.size, 0);

let feedOn = flag("vl.mock.feed") === "on";
const FRIEND = {
  lumi: ["a1b2c3d4-0000-4000-8000-000000000001", "Lumi_Builds"],
  kai: ["a1b2c3d4-0000-4000-8000-000000000002", "KaiCraft"],
  mira: ["a1b2c3d4-0000-4000-8000-000000000003", "mira_px"],
  bau: ["a1b2c3d4-0000-4000-8000-000000000006", "derBaumeister"],
  paula: ["a1b2c3d4-0000-4000-8000-000000000007", "PixelPaula"],
} as const;
const fi = (id: string, who: keyof typeof FRIEND, m: number, type: FeedItem["type"]): FeedItem =>
  type === "screenshot"
    ? { id, userId: FRIEND[who][0], name: FRIEND[who][1], createdAt: ago(m), type, imagePath: `/api/v1/screenshots/f-${id}/image` }
    : { id, userId: FRIEND[who][0], name: FRIEND[who][1], createdAt: ago(m), type };
const feed: FeedItem[] = [
  fi("e1", "lumi", 25, "screenshot"),
  fi("e2", "kai", 70, "played"),
  fi("e3", "mira", 180, "created_instance"),
  fi("e4", "bau", 60 * 5, "screenshot"),
  fi("e5", "paula", 60 * 26, "played"),
  fi("e6", "lumi", 60 * 30, "created_instance"),
  fi("e7", "kai", 60 * 50, "screenshot"),
  fi("e8", "mira", 60 * 52, "played"),
];

const srv = (id: string, name: string, address: string, category: DiscoveryServer["category"], description: string): DiscoveryServer => ({ id, name, address, category, description });
const servers: DiscoveryServer[] =
  flag("vl.mock.discovery") === "empty"
    ? []
    : [
        srv("d1", "VibeCraft SMP", "smp.vibecraft.de", "survival", "Entspanntes Survival ohne Pay-to-Win. Grundstücke, Händlerdorf und wöchentliche Bau-Events. Ab 12 Jahren."),
        srv("d2", "Hypixel", "hypixel.net", "minigames", "Der bekannteste Minispiel-Server: Bed Wars, SkyBlock, Murder Mystery und vieles mehr."),
        srv("d3", "Blockwerk Kreativ", "kreativ.blockwerk.net", "creative", "Eigene Plots mit WorldEdit, Bauwettbewerbe jeden Freitag und eine hilfsbereite Community."),
        srv("d4", "Arena Nord", "pvp.arena-nord.de:25570", "pvp", "Kits, Duelle und Ranglisten. Faire Matches durch Matchmaking nach Können."),
        srv("d5", "Eldoria RP", "play.eldoria.eu", "roleplay", "Mittelalter-Rollenspiel mit Berufen, Städten und eigener Währung. Bewerbung im Discord."),
        srv("d6", "Pixelparkour", "parkour.pixel.gg", "minigames", "Über 300 Parkour-Karten von leicht bis extrem, mit Zeitrangliste."),
        srv("d7", "Werkbank", "old.example.org", "other", "Technik-Server mit Redstone-Tutorials. Gerade im Umbau."),
      ];
const submissions: DiscoverySubmission[] = [
  { id: "s1", name: "Inselreich", address: "insel.example.net", description: "Skyblock auf Deutsch", category: "survival", userId: ME, status: "pending", createdAt: ago(60 * 20) },
  { id: "s2", name: "VibeCraft SMP", address: "smp.vibecraft.de", description: "Unser Server", category: "survival", userId: ME, status: "approved", createdAt: ago(60 * 24 * 12) },
];

let cloud: CloudSettings = { revision: 0, snapshot: null };
let conflictOnce = flag("vl.mock.cloud") === "conflict";
if (flag("vl.mock.cloud") !== "empty") {
  cloud = {
    revision: 3,
    snapshot: {
      version: 1,
      settings: { language: "de", max_memory_mb: 6144, ui_mode: "expert", _meta: { savedAt: ago(60 * 24 * 2), settings: true } },
      instances: [
        { id: "laptop-survival", manifest: { format_version: 1, name: "Laptop Survival", mc_version: "1.21.4", loader: { kind: "fabric", version: "0.16.9" }, files: [] } },
        { id: "survival", manifest: { format_version: 1, name: "Cobblemon Abenteuer", mc_version: "1.21.4", loader: { kind: "fabric", version: "0.16.9" }, files: [] } },
      ],
    },
  };
}

let sessions: DeviceSession[] = [
  { id: "mock-session", client: { name: "vibe-launcher", version: "1.0.0", platform: "windows" }, ip: null, createdAt: ago(60 * 24 * 30), lastUsedAt: ago(0), expiresAt: ago(-60 * 24 * 30), current: true },
  { id: "web-1", client: { name: "Vibe Web-Companion", version: "1.0.0", platform: "web-companion" }, ip: null, createdAt: ago(60 * 24 * 3), lastUsedAt: ago(40), expiresAt: ago(-60 * 24 * 27), current: false },
  { id: "pc-2", client: { name: "vibe-launcher", version: "1.0.0", platform: "windows" }, ip: null, createdAt: ago(60 * 24 * 60), lastUsedAt: ago(60 * 24 * 9), expiresAt: ago(-60 * 24 * 20), current: false },
];

export function vibemediaRoute(method: string, rel: string, query: URLSearchParams, body: Record<string, unknown>): Res | null {
  let m: RegExpMatchArray | null;
  if (rel === "screenshots" && method === "GET") return ok({ screenshots: shots, usedBytes: used(), quotaBytes: quota, maxUploadBytes: 8 * MiB });
  if ((m = rel.match(/^screenshots\/([^/]+)$/))) {
    const i = shots.findIndex((s) => s.id === m![1]);
    if (method === "DELETE") {
      if (i >= 0) shots.splice(i, 1);
      return none;
    }
    if (method === "PATCH") {
      if (i < 0) return err(404, "not_found", "Nicht gefunden");
      const v = body.visibility as ScreenshotVisibility;
      const cur = shots[i];
      const k = v === "link" ? (cur.visibility === "link" ? cur.sharePath : `${cur.imagePath}?key=${key()}`) : null;
      shots[i] = { ...cur, visibility: v, sharePath: k };
      return ok(shots[i]);
    }
  }
  if ((m = rel.match(/^screenshots\/([^/]+)\/report$/)) && method === "POST") return none;

  if (rel === "feed/preferences") {
    if (method === "PUT") feedOn = !!body.enabled;
    return ok({ enabled: feedOn });
  }
  if (rel === "feed/events" && method === "POST") return feedOn ? none : err(403, "feed_disabled", "Aktivitäten sind ausgeschaltet");
  if (rel === "feed" && method === "GET") {
    const limit = Number(query.get("limit")) || 30;
    const before = query.get("before");
    const start = before ? feed.findIndex((f) => f.id === before) + 1 : 0;
    const items = feed.slice(start, start + limit);
    return ok({ items, nextCursor: start + limit < feed.length ? items[items.length - 1].id : null });
  }

  if (rel === "discovery/servers" && method === "GET") {
    const c = query.get("category");
    return ok({ servers: servers.filter((s) => !c || s.category === c) });
  }
  if (rel === "discovery/submissions") {
    if (method === "GET") return ok({ submissions });
    if (method === "POST") {
      const addr = String(body.address ?? "").toLowerCase();
      if (servers.some((s) => s.address === addr)) return err(409, "conflict", "Schon vorhanden");
      const s: DiscoverySubmission = { id: `s${++seq}`, name: String(body.name), address: addr, description: String(body.description), category: body.category as DiscoveryServer["category"], userId: ME, status: "pending", createdAt: new Date().toISOString() };
      submissions.unshift(s);
      return { status: 201, body: s };
    }
  }

  if (rel === "cloud-settings") {
    if (method === "GET") return ok(cloud);
    if (method === "PUT") {
      if (conflictOnce) {
        conflictOnce = false;
        const snap = cloud.snapshot as CloudSnapshot | null;
        cloud = { revision: cloud.revision + 1, snapshot: snap ? { ...snap, settings: { ...snap.settings, _meta: { savedAt: ago(3), settings: true } } } : snap };
        return err(409, "revision_conflict", "Veralteter Stand", cloud);
      }
      if (Number(body.revision) !== cloud.revision) return err(409, "revision_conflict", "Veralteter Stand", cloud);
      cloud = { revision: cloud.revision + 1, snapshot: (body.snapshot as CloudSnapshot | null) ?? null };
      return ok(cloud);
    }
  }

  if (rel === "auth/device/approve" && method === "POST") {
    const code = String(body.code ?? "");
    if (!/^[2-9A-HJ-NP-Z]{8}$/.test(code) || code === "ZZZZZZZZ") return err(404, "not_found", "Der Kopplungscode ist ungültig, bereits benutzt oder abgelaufen.");
    sessions = [{ id: `web-${++seq}`, client: { name: "Vibe Web-Companion", version: "1.0.0", platform: "web-companion" }, ip: null, createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), expiresAt: ago(-60 * 24 * 30), current: false }, ...sessions];
    return none;
  }
  if (rel === "auth/sessions" && method === "GET") return ok(sessions);
  if ((m = rel.match(/^auth\/sessions\/([^/]+)$/)) && method === "DELETE") {
    sessions = sessions.filter((s) => s.id !== m![1]);
    return none;
  }
  return null;
}

const handlers: Handlers = {
  vibe_screenshot_upload: async ({ path, visibility }) => {
    await new Promise((r) => setTimeout(r, 700));
    const size = 2.2 * MiB;
    if (used() + size > quota) throw { kind: "error", message: "shot:quota" };
    const s = shot(`shot-${++seq}`, visibility as ScreenshotVisibility, size, 0);
    shots = [s, ...shots];
    void path;
    return s;
  },
  vibe_image: async ({ url }) => {
    await new Promise((r) => setTimeout(r, 150));
    const u = String(url);
    if (!u.startsWith(API)) throw { kind: "invalid", message: "fremde Adresse" };
    const id = u.match(/screenshots\/([^/]+)\/image/)?.[1] ?? "x";
    if (id.startsWith("shot-") && !shots.some((s) => s.id === id)) throw { kind: "not_found", message: "Nicht gefunden" };
    let n = 0;
    for (const c of id) n = (n * 31 + c.charCodeAt(0)) % 997;
    return landscape(n);
  },
  vibe_cloud_manifests: async ({ instanceIds }) => {
    await new Promise((r) => setTimeout(r, 900));
    return (instanceIds as string[]).flatMap((id) => {
      const i = instances.get(id);
      if (!i) return [];
      return [{ id, manifest: { format_version: 1, name: i.name, version: "1.0.0", mc_version: i.mc_version, loader: { kind: i.loader.kind, version: i.loader.version ?? null }, icon: null, files: [] } }];
    });
  },
  vibe_cloud_restore_instance: ({ manifest }) => fakeTask("import", `${(manifest as { name: string }).name} aus der Cloud wiederherstellen`, null, 2500),
};

export default handlers;
