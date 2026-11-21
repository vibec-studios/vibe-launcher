import type { AddonSource, LoaderKind, PlatformKind, Server, ServerConnection } from "../types";

export const DEFAULT_PROPERTIES: [string, string][] = [
  ["motd", "Ein Vibe-Server"],
  ["gamemode", "survival"],
  ["difficulty", "easy"],
  ["max-players", "20"],
  ["view-distance", "10"],
  ["simulation-distance", "10"],
  ["spawn-protection", "16"],
  ["pvp", "true"],
  ["hardcore", "false"],
  ["white-list", "false"],
  ["enforce-whitelist", "false"],
  ["allow-flight", "false"],
  ["enable-command-block", "false"],
  ["online-mode", "true"],
  ["level-name", "world"],
  ["level-seed", ""],
  ["level-type", "minecraft\\:normal"],
  ["generate-structures", "true"],
  ["spawn-monsters", "true"],
  ["spawn-animals", "true"],
  ["allow-nether", "true"],
  ["server-port", "25565"],
  ["enable-rcon", "false"],
  ["player-idle-timeout", "0"],
];

export interface SeedServer {
  name: string;
  mc: string;
  loader: LoaderKind;
  loaderVersion?: string;
  platform?: PlatformKind;
  connection: ServerConnection;
  running: boolean;
  memory: number;
  players?: string[];
  motd: string;
  slot?: string;
}

export const SEEDS: Record<string, SeedServer[]> = {
  home: [
    { name: "Survival mit Freunden", mc: "1.21.4", loader: "vanilla", platform: "paper", connection: "relay", running: true, memory: 4096, players: ["Steve_42", "AlexBaut"], motd: "Willkommen bei uns!", slot: "henny-survival" },
    { name: "Create-Modpack", mc: "1.21.1", loader: "neoforge", loaderVersion: "21.1.77", connection: "local", running: false, memory: 6144, motd: "Zahnräder und Züge" },
    { name: "Kreativ-Bauwelt", mc: "1.21.4", loader: "fabric", loaderVersion: "0.16.10", connection: "playit", running: false, memory: 2048, motd: "Nur bauen, nicht sterben" },
  ],
  vps: [{ name: "Community SMP", mc: "1.21.4", loader: "vanilla", platform: "purpur", connection: "relay", running: true, memory: 8192, players: ["Notch", "jeb_", "Dinnerbone", "Grumm"], motd: "Community SMP · seit 2024", slot: "community-smp" }],
  laptop: [],
};

export function makeServer(id: string, s: SeedServer, i: number): Server {
  const now = Date.now();
  return {
    id,
    name: s.name,
    icon: null,
    accent: null,
    mc_version: s.mc,
    loader: { kind: s.loader, version: s.loaderVersion ?? null },
    platform: s.platform ? { kind: s.platform, build: null } : null,
    memory_mb: s.memory,
    java_path: null,
    jvm_args: null,
    port: 25565 + i,
    auto_start: s.running,
    auto_restart: true,
    connection: s.connection,
    eula: true,
    install_state: "installed",
    created_at: now - (40 - i * 7) * 86_400_000,
    last_started: s.running ? now - 3 * 3_600_000 : now - 2 * 86_400_000,
    source_instance: null,
    relay_slot: s.slot ?? null,
    voice: false,
    bedrock: false,
  };
}

export interface CatalogEntry {
  source: AddonSource;
  id: string;
  title: string;
  author: string;
  description: string;
  downloads: number;
  kind: "plugin" | "mod";
  loaders: string[];
  mc: string[];
  side: "server" | "both" | "client";
}

const ALL = ["1.20.1", "1.20.4", "1.20.6", "1.21", "1.21.1", "1.21.3", "1.21.4"];
const NEW = ["1.21", "1.21.1", "1.21.3", "1.21.4"];
const PLUGIN = ["paper", "purpur", "folia"];

export const CATALOG: CatalogEntry[] = [
  { source: "modrinth", id: "luckperms", title: "LuckPerms", author: "Luck", description: "Rechte-System: lege fest, wer was darf.", downloads: 4_200_000, kind: "plugin", loaders: [...PLUGIN, "fabric", "neoforge", "forge"], mc: ALL, side: "server" },
  { source: "hangar", id: "EssentialsX", title: "EssentialsX", author: "EssentialsX Team", description: "Grundbefehle wie /home, /spawn, /tpa und Kits.", downloads: 3_100_000, kind: "plugin", loaders: ["paper", "purpur"], mc: ALL, side: "server" },
  { source: "modrinth", id: "worldedit", title: "WorldEdit", author: "EngineHub", description: "Große Bauwerke in Sekunden: kopieren, füllen, ersetzen.", downloads: 5_600_000, kind: "plugin", loaders: [...PLUGIN, "fabric", "neoforge"], mc: ALL, side: "both" },
  { source: "hangar", id: "Geyser", title: "Geyser", author: "GeyserMC", description: "Lässt Bedrock-Spieler (Handy, Konsole) mitspielen.", downloads: 2_400_000, kind: "plugin", loaders: PLUGIN, mc: NEW, side: "server" },
  { source: "modrinth", id: "simple-voice-chat", title: "Simple Voice Chat", author: "henkelmax", description: "Sprachchat in der Nähe – wie im echten Leben.", downloads: 8_900_000, kind: "plugin", loaders: [...PLUGIN, "fabric", "neoforge", "forge", "quilt"], mc: ALL, side: "both" },
  { source: "modrinth", id: "chunky", title: "Chunky", author: "pop4959", description: "Erzeugt die Welt vorab, damit später nichts ruckelt.", downloads: 1_900_000, kind: "plugin", loaders: [...PLUGIN, "fabric", "neoforge", "forge"], mc: ALL, side: "server" },
  { source: "hangar", id: "CoreProtect", title: "CoreProtect", author: "Intelli", description: "Protokolliert Blöcke und macht Griefing rückgängig.", downloads: 1_200_000, kind: "plugin", loaders: ["paper", "purpur"], mc: ALL, side: "server" },
  { source: "hangar", id: "ViaVersion", title: "ViaVersion", author: "ViaVersion", description: "Spieler mit neueren Minecraft-Versionen können beitreten.", downloads: 2_000_000, kind: "plugin", loaders: PLUGIN, mc: ALL, side: "server" },
  { source: "modrinth", id: "lithium", title: "Lithium", author: "CaffeineMC", description: "Macht den Server schneller, ohne das Spiel zu verändern.", downloads: 21_000_000, kind: "mod", loaders: ["fabric", "quilt", "neoforge"], mc: ALL, side: "both" },
  { source: "modrinth", id: "ferrite-core", title: "FerriteCore", author: "malte0811", description: "Spart Arbeitsspeicher.", downloads: 19_000_000, kind: "mod", loaders: ["fabric", "quilt", "forge", "neoforge"], mc: ALL, side: "both" },
  { source: "modrinth", id: "create", title: "Create", author: "simibubi", description: "Zahnräder, Maschinen und Fabriken.", downloads: 12_000_000, kind: "mod", loaders: ["neoforge", "forge"], mc: ["1.20.1", "1.21.1"], side: "both" },
  { source: "modrinth", id: "sodium", title: "Sodium", author: "CaffeineMC", description: "Mehr FPS beim Spielen.", downloads: 40_000_000, kind: "mod", loaders: ["fabric", "quilt", "neoforge"], mc: ALL, side: "client" },
  { source: "modrinth", id: "fabric-api", title: "Fabric API", author: "modmuss50", description: "Grundbaustein für fast alle Fabric-Mods.", downloads: 90_000_000, kind: "mod", loaders: ["fabric"], mc: ALL, side: "both" },
  { source: "modrinth", id: "jei", title: "Just Enough Items", author: "mezz", description: "Zeigt alle Rezepte im Spiel an.", downloads: 30_000_000, kind: "mod", loaders: ["forge", "neoforge", "fabric"], mc: ALL, side: "both" },
];

export const MC_VERSIONS = ["1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.16.5", "1.12.2"];

export const CHAT = [
  "<Steve_42> hat jemand Eisen?",
  "<AlexBaut> ich bau gerade am Leuchtturm weiter",
  "<Steve_42> lol creeper",
  "Saving the game (this may take a moment!)",
  "Saved the game",
  "<AlexBaut> gute Nacht ihr",
  "Can't keep up! Is the server overloaded? Running 2034ms or 40 ticks behind",
];
