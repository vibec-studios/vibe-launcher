import type { Addon, LogLevel, LogLine, Server, ServerBackup, ServerPlayers, ServerStatus, TunnelStatus } from "../types";
import { DEFAULT_PROPERTIES } from "./seed";

export interface MockFile {
  data: string | Blob;
  modified: number;
}

export interface ServerState {
  server: Server;
  status: ServerStatus;
  log: LogLine[];
  seq: number;
  props: Map<string, string>;
  players: ServerPlayers;
  backups: ServerBackup[];
  files: Map<string, MockFile>;
  dirs: Set<string>;
  addons: Addon[];
  cpu: number;
}

export function emptyStatus(id: string): ServerStatus {
  return { server_id: id, state: "stopped", pid: null, started_at: null, players: [], max_players: 20, exit_code: null, detached: false, tunnel: null };
}

export function tunnelFor(s: Server, running: boolean): TunnelStatus | null {
  if (!running || s.connection === "local") return null;
  if (s.connection === "playit") {
    return { kind: "playit", state: "claim", address: null, claim_url: "https://playit.gg/claim/demo", message: "Bitte den Agenten bei playit.gg bestätigen.", udp: null };
  }
  const slot = s.relay_slot ?? s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    kind: "relay",
    state: "online",
    address: `${slot}.axolite.cc`,
    claim_url: null,
    message: null,
    udp: { state: s.voice || s.bedrock ? "ok" : "off", voice: s.voice ? { host: "relay.axolite.cc", port: 24454, address: "relay.axolite.cc:24454" } : null, bedrock: null, denied: [] },
  };
}

export function propertiesText(props: Map<string, string>): string {
  return ["#Minecraft server properties", `#${new Date().toUTCString()}`, ...[...props].map(([k, v]) => `${k}=${v}`)].join("\n") + "\n";
}

export function parseProperties(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    map.set(line.slice(0, i).trim(), line.slice(i + 1));
  }
  return map;
}

function file(data: string, ageDays = 3): MockFile {
  return { data, modified: Date.now() - ageDays * 86_400_000 };
}

export function newServerState(server: Server, motd: string, online: string[], running: boolean): ServerState {
  const props = new Map(DEFAULT_PROPERTIES);
  props.set("motd", motd);
  props.set("server-port", String(server.port));
  const plugin = !!server.platform;
  const folder = plugin ? "plugins" : "mods";
  const files = new Map<string, MockFile>([
    ["eula.txt", file("eula=true\n", 30)],
    ["ops.json", file('[\n  { "uuid": "069a79f4-44e9-4726-a5be-fca90e38aaf5", "name": "Steve_42", "level": 4 }\n]\n')],
    ["whitelist.json", file("[]\n")],
    ["logs/latest.log", file("[12:00:00] [Server thread/INFO]: Starting minecraft server version " + server.mc_version + "\n", 0)],
    ["world/level.dat", { data: new Blob([new Uint8Array(2048)]), modified: Date.now() - 600_000 }],
    ["world/region/r.0.0.mca", { data: new Blob([new Uint8Array(8192)]), modified: Date.now() - 600_000 }],
    ["config/README.txt", file("Hier liegen die Einstellungen von Mods und Plugins.\n", 10)],
  ]);
  if (plugin) {
    files.set("bukkit.yml", file("settings:\n  allow-end: true\n  warn-on-overload: true\n  connection-throttle: 4000\n"));
    files.set("plugins/LuckPerms/config.yml", file("server: global\nstorage-method: h2\n"));
  }
  const addons: Addon[] = plugin
    ? [
        addon("LuckPerms-Bukkit-5.4.150.jar", "LuckPerms", "5.4.150", "luckperms", "modrinth", "Rechte-System"),
        addon("Chunky-Bukkit-1.4.28.jar", "Chunky", "1.4.28", "chunky", "modrinth", "Welt vorab erzeugen"),
      ]
    : server.loader.kind === "vanilla"
      ? []
      : [addon("lithium-0.14.7.jar", "Lithium", "0.14.7", "lithium", "modrinth", "Schnellerer Server"), addon("ferritecore-7.1.1.jar", "FerriteCore", "7.1.1", "ferrite-core", "modrinth", "Weniger RAM")];
  for (const a of addons) files.set(`${folder}/${a.file_name}`, { data: new Blob([new Uint8Array(a.size)]), modified: a.modified });
  const dirs = new Set(["logs", "world", "world/region", "config", folder, ...(plugin ? ["plugins/LuckPerms"] : [])]);
  const state: ServerState = {
    server,
    status: emptyStatus(server.id),
    log: [],
    seq: 0,
    props,
    players: {
      online: running ? online : [],
      whitelist_enabled: false,
      whitelist: online.map((name) => ({ name, uuid: null, level: null, reason: null })),
      ops: [{ name: "Steve_42", uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", level: 4, reason: null }],
      banned: [{ name: "Griefer123", uuid: null, level: null, reason: "Hat das Rathaus angezündet" }],
      banned_ips: [],
    },
    backups: [
      { name: "world-2026-11-20_03-00.zip", world: "world", size: 184_000_000, created: Date.now() - 34 * 3_600_000 },
      { name: "world-2026-11-19_03-00.zip", world: "world", size: 179_500_000, created: Date.now() - 58 * 3_600_000 },
    ],
    files,
    dirs,
    addons,
    cpu: 0,
  };
  files.set("server.properties", file(propertiesText(props), 1));
  return state;
}

function addon(file_name: string, title: string, version: string, project: string, source: "modrinth" | "hangar", description: string): Addon {
  return {
    file_name,
    enabled: true,
    size: 300_000 + file_name.length * 9_000,
    modified: Date.now() - 5 * 86_400_000,
    name: title,
    version,
    authors: [],
    description,
    icon: null,
    source,
    project_id: project,
    title,
    page_url: source === "modrinth" ? `https://modrinth.com/project/${project}` : `https://hangar.papermc.io/${project}`,
  };
}

export function logLine(st: ServerState, text: string, level: LogLevel = "info", thread = "Server thread"): LogLine {
  const d = new Date();
  const time = d.toTimeString().slice(0, 8);
  st.seq += 1;
  const line: LogLine = { seq: st.seq, time, level, thread, logger: null, text };
  st.log.push(line);
  if (st.log.length > 2000) st.log.splice(0, st.log.length - 2000);
  return line;
}

export { addon as makeAddon };
