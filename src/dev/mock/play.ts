// Mock: „Spiel mit mir“-Links (docs/PLAY-LINKS.md). Testcodes im Browser über `?join=<code>`:
//   k3x9q2 = Modpack, Host online · abc234 = Mod-Liste, Host offline · gone22 = abgelaufen
//   nover2 = Version nicht verfügbar · cfman2 = CurseForge-Dateien zum Selbst-Herunterladen
// `?running=<instanz>` startet die Instanz beim Laden (hostende Welt mit Spiel-Link → Teilen-Leiste).
import type { JoinPreview, PlayLink } from "@/lib/types";
import { instances } from "./core";
import a from "./a";
import { states } from "./sessions";
import { fakeTask, mockEmit, type Handlers } from "./util";

const HOST = { uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", name: "Henny" };
const exp = () => new Date(Date.now() + 11 * 3600_000).toISOString();

function link(code: string): PlayLink {
  const base: PlayLink = {
    code,
    url: `https://axolite.cc/j/${code}`,
    host: HOST,
    relay_host: "mossy-otter-27.axolite.cc",
    mc_version: "1.21.1",
    loader: { kind: "fabric", version: "0.16.9" },
    pack: { source: "modrinth", project_id: "Jkb29YJU", version_id: "def", title: "Cobblemon Official" },
    mods: [{ source: "modrinth", project_id: "AANobbMI", version_id: "xyz", kind: "mod" }],
    client_pack: "vibey",
    world_name: "Cobblemon Abenteuer",
    max_players: 8,
    active: true,
    expires_at: exp(),
  };
  if (code === "abc234")
    return {
      ...base,
      pack: null,
      world_name: "Bauprojekt",
      mods: Array.from({ length: 23 }, (_, i) => ({ source: "modrinth" as const, project_id: `mod${i}`, version_id: `v${i}`, kind: "mod" as const })),
      active: false,
    };
  if (code === "nover2") return { ...base, mc_version: "1.99.0", pack: null };
  if (code === "cfman2") return { ...base, pack: { source: "curseforge", project_id: "925200", version_id: "6000000", title: "All the Mods 10" }, loader: { kind: "neoforge", version: "21.1.77" } };
  return base;
}

function preview(l: PlayLink): JoinPreview {
  const p: JoinPreview = {
    instance_id: null,
    instance_name: null,
    create: true,
    pack_title: l.pack?.title ?? null,
    pack_icon: l.pack ? "https://cdn.modrinth.com/data/MdwFAVRL/0ad6c4d2f2e3d3cc8a0ca9e4d6f1b7a5b8e2e9a4.png" : null,
    pack_version: l.pack ? "1.6.1" : null,
    mods: l.pack ? 0 : l.mods.length,
    pack_files: l.pack ? 214 : 0,
    client_pack: "vibey",
    download_bytes: l.pack ? 812_000_000 : 96_400_000,
    game_download: true,
    manual: [],
    problem: null,
    problem_detail: null,
  };
  if (l.code === "abc234") return { ...p, create: false, instance_id: "survival", instance_name: "Survival 1.21", mods: 4, client_pack: null, game_download: false, download_bytes: 18_300_000 };
  if (l.code === "nover2") return { ...p, problem: "version_unavailable", problem_detail: "Minecraft 1.99.0 ist nicht verfügbar." };
  if (l.code === "cfman2") return { ...p, pack_icon: null, pack_version: "ATM10-2.3", manual: ["Create: Steam 'n' Rails", "Waystones", "Farmer's Delight"], client_pack: null };
  return p;
}

// Bis der Dialog den Link lädt (React StrictMode ruft `app_actions_take` doppelt auf)
let consumed = false;
function takeOnce() {
  const code = new URLSearchParams(location.search).get("join");
  return code && !consumed ? [{ kind: "play_link", code }] : [];
}

const handlers: Handlers = {
  app_actions_take: () => takeOnce(),
  play_link_get: ({ code }) => {
    consumed = true;
    if (code === "gone22") throw { kind: "not_found", message: "Nicht gefunden: play_link_expired" };
    return link(code as string);
  },
  play_join_preview: ({ link: l }) => preview(l as PlayLink),
  play_join_setup: ({ link: l, instanceId }) => {
    const target = (instanceId as string | null) ?? "survival";
    return fakeTask("play_join", `Einladung von ${(l as PlayLink).host.name} vorbereiten`, target, 3000, () => {
      const i = instances.get(target);
      if (i) mockEmit("instance://changed", i);
    });
  },
  play_sessions: () =>
    [...new Set([...states.values()].filter((s) => s.state === "running").map((s) => s.instance_id))]
      .map((instance_id) => ({
        instance_id,
        session: {
          schema: 1,
          state: "hosting",
          server: null,
          world: "Neue Welt",
          play_link: "https://axolite.cc/j/k3x9q2",
          players: 2,
          max_players: 8,
          updated_at: Math.floor(Date.now() / 1000),
        },
      })),
};

{
  const run = new URLSearchParams(location.search).get("running");
  if (run) setTimeout(() => a.instance_launch({ id: run }), 300);
}

export default handlers;
