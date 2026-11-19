// Mock: realistische Startseite (zuletzt gespielte Welten/Server, Updates, Freunde online/hostend, Vibe-Nachricht).
// Varianten per localStorage (oder Playwright-Init-Skript):
//   vl.mock.empty = "1"   -> keine Instanzen (Erststart)
//   vl.mock.vibe  = "0"   -> Vibe-Hauptschalter aus
//   vl.mock.panel = "1"   -> Freunde-Panel offen
//   vl.mock.shots = "empty" -> keine Screenshots, vl.mock.stats = "empty" -> keine Spielzeit
// Nur für VITE_MOCK=1.
import type { RecentServer, Settings, World } from "@/lib/types";
import type { Friend, HostSession } from "@/lib/vibe-sdk";
import { useSocial } from "@/features/social/service";
import core, { instances } from "./core";
import a from "./a";
import type { Handlers } from "./util";

const flag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

const now = Date.now();
const H = 3600_000;
const D = 24 * H;

// Instanzen wie bei jemandem, der regelmäßig spielt
const patch = (id: string, p: object) => {
  const i = instances.get(id);
  if (i) instances.set(id, { ...i, ...p });
};
patch("vanilla", { last_played: now - 3 * D, play_time_secs: 4 * 3600 + 1200, accent: "#5fbf4a" });
patch("old-forge", { last_played: now - 41 * D, play_time_secs: 52 * 3600, accent: "#e0a43f" });
patch("hh-armors", { last_played: now - 2 * D - 5 * H });
if (flag("vl.mock.empty") === "1") instances.clear();

if (flag("vl.mock.vibe") === "0") {
  const s = core.settings_get({}) as Settings;
  core.settings_set({ settings: { ...s, vibe: { ...s.vibe, enabled: false } } });
}

const extraWorlds: Record<string, World[]> = {
  vanilla: [
    { folder: "Insel", name: "Inselwelt", last_played: now - 3 * D, game_mode: "survival", icon: null, size: 96_000_000 },
    { folder: "Redstone", name: "Redstone-Labor", last_played: now - 12 * D, game_mode: "creative", icon: null, size: 21_000_000 },
  ],
};

const servers: RecentServer[] = [
  { address: "cobblemon.vibecraft.de", instance_id: "survival", last_played: now - 26 * H, play_time_secs: 7200 },
  { address: "hypixel.net", instance_id: "vanilla", last_played: now - 6 * D, play_time_secs: 3600 },
];

// Pixel-Landschaft als „Screenshot“ (nur Mock)
function landscape(seed: number) {
  const r = (n: number) => (Math.sin(seed * 97 + n * 13.7) + 1) / 2;
  let hills = "";
  for (let x = 0; x < 160; x += 4) hills += `<rect x="${x}" y="${44 + Math.round(r(x) * 10)}" width="4" height="60" fill="#3d7a3a"/>`;
  let ground = "";
  for (let x = 0; x < 160; x += 4)
    ground += `<rect x="${x}" y="${60 + Math.round(r(x + 99) * 4)}" width="4" height="40" fill="#5fae3f"/><rect x="${x}" y="${66 + Math.round(r(x + 99) * 4)}" width="4" height="40" fill="#7a5537"/>`;
  let trees = "";
  for (const x of [22, 58, 118, 140])
    trees += `<rect x="${x + 3}" y="44" width="3" height="18" fill="#5b3b22"/><rect x="${x - 3}" y="34" width="15" height="12" fill="#2f6b2b"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" shape-rendering="crispEdges"><rect width="160" height="90" fill="${seed % 2 ? "#7fb6f0" : "#f0a86b"}"/><rect x="120" y="10" width="12" height="12" fill="#fff4b0"/><rect x="18" y="16" width="28" height="5" fill="#fff" opacity=".8"/><rect x="70" y="22" width="20" height="4" fill="#fff" opacity=".7"/>${hills}${ground}${trees}<rect x="84" y="62" width="30" height="5" fill="#3f76e4"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const shots = [
  {
    instance_id: "survival",
    file_name: "2026-11-18_19.42.10.png",
    path: "C:/mock/shots/a.png",
    size: 2_400_000,
    width: 1920,
    height: 1080,
    taken_at: now - 70 * 60_000,
  },
  {
    instance_id: "vanilla",
    file_name: "2026-11-15_12.01.33.png",
    path: "C:/mock/shots/b.png",
    size: 2_100_000,
    width: 1920,
    height: 1080,
    taken_at: now - 3 * D,
  },
  // weitere Aufnahmen über die letzten Wochen, damit die Galerie realistisch gefüllt ist
  ...Array.from({ length: 16 }, (_, n) => {
    const t = now - (n < 3 ? 26 * H + n * H : n < 8 ? (2 + n) * D : (20 + n * 4) * D);
    const d = new Date(t);
    const p2 = (x: number) => String(x).padStart(2, "0");
    return {
      instance_id: ["survival", "vanilla", "hh-armors", "old-forge"][n % 4],
      file_name: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}.${p2(d.getMinutes())}.0${n % 10}.png`,
      path: `C:/mock/shots/s${n + 3}.png`,
      size: 1_800_000 + n * 40_000,
      width: 1920,
      height: 1080,
      taken_at: t,
    };
  }),
];

// Spielzeit-Sitzungen der letzten Monate (deterministisch, damit Screenshots stabil bleiben)
const sessions = (() => {
  const out: { instance_id: string; start: number; end: number }[] = [];
  const ids = ["survival", "survival", "hh-armors", "vanilla", "survival", "old-forge"];
  const day0 = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
  for (let d = 0; d < 330; d++) {
    const r = (Math.sin(d * 12.9898) * 43758.5453) % 1;
    const v = Math.abs(r);
    if (d > 2 && v < 0.45) continue;
    const id = ids[Math.floor(v * 97) % ids.length];
    const start = day0 - d * D + (17 + Math.floor(v * 4)) * H;
    const len = (0.4 + v * 2.6) * H;
    out.push({ instance_id: id, start, end: Math.min(start + len, now - 5 * 60_000) });
  }
  return out.filter((s) => s.end > s.start);
})();

const handlers: Handlers = {
  playtime_sessions: ({ since }) => (flag("vl.mock.stats") === "empty" ? [] : sessions.filter((s) => s.end > ((since as number | null) ?? 0))),
  screenshots_list: ({ instanceId }) =>
    flag("vl.mock.shots") === "empty" ? [] : shots.filter((x) => !instanceId || x.instance_id === instanceId),
  screenshot_thumb: ({ path }) => {
    const m = /s(\d+)\.png$/.exec(String(path));
    return landscape(m ? Number(m[1]) : String(path).includes("a.png") ? 1 : 2);
  },
  worlds_list: (args) => [...((a.worlds_list(args) as World[]) ?? []), ...(extraWorlds[args.instanceId as string] ?? [])],
  servers_recent: () => servers.filter((s) => instances.has(s.instance_id)),
  server_ping: ({ address }) => ({
    online: address !== "old.example.org",
    motd: "§aWillkommen!",
    players_online: address === "hypixel.net" ? 31842 : 23,
    players_max: address === "hypixel.net" ? 200000 : 100,
    players_sample: [],
    version: "1.21.4",
    protocol: 769,
    favicon: null,
    latency_ms: 38,
    error: null,
  }),
  content_update_counts: () => ({ survival: 3, "hh-armors": 5 }),
  launchers_detect: () => [
    {
      id: "prism",
      name: "Prism Launcher",
      path: "C:\\Users\\steve\\AppData\\Roaming\\PrismLauncher",
      instances: Array.from({ length: 7 }, (_, n) => ({
        source_path: `p${n}`,
        name: `Prism ${n}`,
        mc_version: "1.20.1",
        loader: { kind: "forge", version: "47.3.0" },
        icon: null,
        mod_count: 40,
        last_played: null,
      })),
    },
    {
      id: "curseforge",
      name: "CurseForge",
      path: "C:\\Users\\steve\\curseforge\\minecraft\\Instances",
      instances: [
        { source_path: "c0", name: "ATM9", mc_version: "1.20.1", loader: { kind: "forge", version: "47.3.0" }, icon: null, mod_count: 400, last_played: null },
      ],
    },
  ],
};

// ------------------------------------------------------------------ Vibe: Freunde

const user = (id: string, name: string, statusText: string | null = null) => ({
  id,
  name,
  skin: null as never,
  statusText,
  badge: null as never,
  createdAt: new Date(now - 90 * D).toISOString(),
});
const friend = (u: ReturnType<typeof user>, status: Friend["presence"]["status"], activity: Friend["presence"]["activity"]): Friend => ({
  user: u,
  since: new Date(now - 60 * D).toISOString(),
  presence: { userId: u.id, status, activity, updatedAt: new Date().toISOString() },
});
const lena = user("8667ba71-b85a-4004-af54-457a9734eed7", "LenaBuilds");
const max = user("069a79f4-44e9-4726-a5be-fca90e38aaf5", "Notch");
const tom = user("853c80ef-3c37-49fd-aa49-938b674adae6", "jeb_");
const kim = user("61699b2e-d327-4a01-9f1e-0ea8c3f06bc6", "Dinnerbone", "baut gerade eine Burg");
const friends: Friend[] = [
  friend(lena, "online", { type: "hosting", world: "Lenas Insel", mcVersion: "1.21.4", loader: "fabric" }),
  friend(max, "online", { type: "playing", instanceName: "Cobblemon Abenteuer", mcVersion: "1.21.4", loader: "fabric" }),
  friend(tom, "online", { type: "launcher" }),
  friend(kim, "offline", null),
];
const host: HostSession = {
  id: "h1",
  host: lena as never,
  kind: "world",
  client: "mod",
  slot: 1,
  address: "lena.relay.vibecraft.de",
  mcVersion: "1.21.4",
  status: "online",
  players: [],
  maxPlayers: 8,
  startedAt: new Date(now - H).toISOString(),
  onlineAt: new Date(now - H).toISOString(),
  endedAt: null,
  endReason: null,
};

/** Sitzung „verbunden“ setzen – auch erneut, falls der echte Verbindungsaufbau (ohne Backend) sie zurücksetzt. */
function seedSocial() {
  if (flag("vl.mock.vibe") === "0") return;
  useSocial.setState({
    conn: "ready",
    friends: Object.fromEntries(friends.map((f) => [f.user.id, f])),
    hosts: { [host.id]: host },
    motd: "Neu: Welten hosten jetzt auch für Forge 1.20.1. Viel Spaß beim gemeinsamen Spielen!",
    panelOpen: flag("vl.mock.panel") === "1",
  });
}
let seeded = 0;
const timer = setInterval(() => {
  if (useSocial.getState().conn !== "ready") seedSocial();
  if (++seeded > 20) clearInterval(timer);
}, 250);

export default handlers;
