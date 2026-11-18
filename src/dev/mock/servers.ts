// Mock: Lokale Server – zwei Beispielserver, simulierte Status-/Log-Events, Tunnel (Relay/playit-Claim),
// Spielerlisten, Welten und Backups.
import type {
  LogLevel,
  LogLine,
  Server,
  ServerBackup,
  ServerCreate,
  ServerModCandidate,
  ServerPatch,
  ServerPlayerEntry,
  ServerPlayerList,
  ServerPlayers,
  ServerStatus,
  ServerWorld,
  TunnelStatus,
} from "@/lib/types";
import { instances } from "./core";
import { fakeTask, mockEmit, type Handlers } from "./util";

const now = Date.now();

function mkServer(id: string, name: string, extra: Partial<Server>): Server {
  return {
    id,
    name,
    icon: null,
    accent: null,
    mc_version: "1.21.4",
    loader: { kind: "vanilla", version: null },
    memory_mb: null,
    java_path: null,
    jvm_args: null,
    port: 25565,
    auto_start: false,
    auto_restart: true,
    connection: "local",
    eula: true,
    install_state: "installed",
    created_at: now - 86400_000 * 6,
    last_started: null,
    source_instance: null,
    ...extra,
  };
}

const servers = new Map<string, Server>(
  [
    mkServer("survival-smp", "Survival SMP", {
      accent: "#3fe0c5",
      loader: { kind: "fabric", version: "0.16.9" },
      memory_mb: 4096,
      connection: "playit",
      last_started: now - 3600_000,
      source_instance: "survival",
    }),
    mkServer("kreativ", "Kreativwelt", { accent: "#ffb547", port: 25566, connection: "relay", eula: false, last_started: now - 86400_000 * 3 }),
  ].map((s) => [s.id, s]),
);

const statuses = new Map<string, ServerStatus>();
const logs = new Map<string, LogLine[]>();
const seqs = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setInterval>>();

function status(id: string): ServerStatus {
  return (
    statuses.get(id) ?? {
      server_id: id,
      state: "stopped",
      pid: null,
      started_at: null,
      players: [],
      max_players: null,
      exit_code: null,
      detached: false,
      tunnel: null,
    }
  );
}

function setStatus(id: string, patch: Partial<ServerStatus>) {
  const next = { ...status(id), ...patch };
  statuses.set(id, next);
  mockEmit("server://status", next);
}

const clock = () => new Date().toTimeString().slice(0, 8);

function log(id: string, text: string, level: LogLevel = "info", thread = "Server thread") {
  const seq = seqs.get(id) ?? 0;
  seqs.set(id, seq + 1);
  const line: LogLine = { seq, time: clock(), level, thread, logger: level === "launcher" ? "Vibe Launcher" : null, text };
  const buf = logs.get(id) ?? [];
  buf.push(line);
  logs.set(id, buf);
  mockEmit("server://log", { server_id: id, lines: [line] });
}

// ------------------------------------------------------------------ Spieler, Welten, Backups, Properties

const entry = (name: string, extra: Partial<ServerPlayerEntry> = {}): ServerPlayerEntry => ({ name, uuid: null, level: null, reason: null, ...extra });

const players = new Map<string, ServerPlayers>([
  [
    "survival-smp",
    {
      online: [],
      whitelist_enabled: true,
      whitelist: [entry("Steve"), entry("Alex"), entry("Henny"), entry("Notch")],
      ops: [entry("Henny", { level: 4 })],
      banned: [entry("Griefer123", { reason: "Hat das Rathaus angezündet" })],
      banned_ips: [entry("203.0.113.7", { reason: "Spam" })],
    },
  ],
  ["kreativ", { online: [], whitelist_enabled: false, whitelist: [], ops: [entry("Henny", { level: 4 })], banned: [], banned_ips: [] }],
]);

const worlds = new Map<string, ServerWorld[]>([
  [
    "survival-smp",
    [
      { name: "world", size: 412_000_000, active: true },
      { name: "world_alt", size: 96_000_000, active: false },
    ],
  ],
  ["kreativ", [{ name: "world", size: 58_000_000, active: true }]],
]);

const backups = new Map<string, ServerBackup[]>([
  [
    "survival-smp",
    [
      { name: "world-2026-11-16_20-14.zip", world: "world", size: 380_000_000, created: now - 86400_000 },
      { name: "world-2026-11-10_18-02.zip", world: "world", size: 352_000_000, created: now - 86400_000 * 7 },
      { name: "world_alt-2026-10-30_12-00.zip", world: "world_alt", size: 91_000_000, created: now - 86400_000 * 18 },
    ],
  ],
  ["kreativ", []],
]);

function defaultProps(s: Server): [string, string][] {
  return [
    ["motd", s.id === "kreativ" ? "Bauen ohne Grenzen" : "§bSurvival SMP §7– Freunde willkommen"],
    ["gamemode", s.id === "kreativ" ? "creative" : "survival"],
    ["difficulty", "normal"],
    ["max-players", "20"],
    ["pvp", "true"],
    ["white-list", s.id === "kreativ" ? "false" : "true"],
    ["view-distance", "10"],
    ["simulation-distance", "10"],
    ["level-name", "world"],
    ["level-seed", ""],
    ["online-mode", "true"],
    ["hardcore", "false"],
    ["enable-command-block", "false"],
    ["spawn-protection", "16"],
    ["server-port", String(s.port)],
  ];
}
const props = new Map<string, [string, string][]>([...servers.values()].map((s) => [s.id, defaultProps(s)]));

const rawOf = (id: string) => "#Minecraft server properties\n#" + new Date().toUTCString() + "\n" + (props.get(id) ?? []).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";

// ------------------------------------------------------------------ Simulation

function tunnelFor(s: Server): TunnelStatus | null {
  if (s.connection === "local") return null;
  return { kind: s.connection, state: "connecting", address: null, claim_url: null, message: null };
}

const claimed = new Set<string>();
const relayAddr = new Map<string, string>([["kreativ", "vibey.henny.dev:41237"]]);

function startTunnel(id: string) {
  const s = servers.get(id);
  if (!s || s.connection === "local") return;
  setStatus(id, { tunnel: tunnelFor(s) });
  setTimeout(() => {
    if (status(id).state !== "running" && status(id).state !== "starting") return;
    if (s.connection === "playit" && !claimed.has(id)) {
      setStatus(id, {
        tunnel: { kind: "playit", state: "claim", address: null, claim_url: "https://playit.gg/claim/4f2a9c1e7b", message: null },
      });
      log(id, "playit: Agent muss im Browser bestätigt werden: https://playit.gg/claim/4f2a9c1e7b", "launcher");
    } else if (s.connection === "playit") {
      setStatus(id, { tunnel: { kind: "playit", state: "online", address: "dragon-lamp.gl.joinmc.link", claim_url: null, message: null } });
    } else {
      const addr = relayAddr.get(id) ?? `vibey.henny.dev:${40000 + Math.floor(Math.random() * 9999)}`;
      relayAddr.set(id, addr);
      setStatus(id, { tunnel: { kind: "relay", state: "online", address: addr, claim_url: null, message: null } });
      log(id, `Relay verbunden: ${addr}`, "launcher");
    }
  }, 1400);
}

function boot(id: string, initialPlayers: string[] = []) {
  const s = servers.get(id)!;
  seqs.set(id, 0);
  logs.set(id, []);
  setStatus(id, { state: "starting", pid: 10000 + Math.floor(Math.random() * 9000), started_at: Date.now(), players: [], max_players: 20, exit_code: null, detached: false, tunnel: tunnelFor(s) });
  log(id, `Starte ${s.name} (${s.loader.kind} ${s.mc_version}) mit ${s.memory_mb ?? 2048} MB`, "launcher");
  const steps: [string, LogLevel?][] = [
    [`Starting minecraft server version ${s.mc_version}`],
    ["Loading properties"],
    ["Default game type: SURVIVAL"],
    ["Generating keypair"],
    [`Starting Minecraft server on *:${s.port}`],
    ["Using epoll channel type"],
    ...(s.loader.kind !== "vanilla" ? ([["Loading 42 mods: fabric-api 0.110.5, lithium 0.14.3, ferritecore 7.1.1, …"], ["Mod 'Chunky' uses deprecated API", "warn"]] as [string, LogLevel?][]) : []),
    ['Preparing level "world"'],
    ["Preparing start region for dimension minecraft:overworld"],
    ["Preparing spawn area: 0%"],
    ["Preparing spawn area: 46%"],
    ["Preparing spawn area: 100%"],
    ["Time elapsed: 2341 ms"],
    ['Done (4.127s)! For help, type "help"'],
  ];
  let i = 0;
  const t = setInterval(() => {
    if (status(id).state !== "starting") return clearInterval(t);
    const [text, level] = steps[i++];
    log(id, text, level);
    if (i >= steps.length) {
      clearInterval(t);
      servers.set(id, { ...servers.get(id)!, last_started: Date.now() });
      mockEmit("servers://changed", servers.get(id)!);
      setStatus(id, { state: "running", players: initialPlayers });
      for (const p of initialPlayers) log(id, `${p} joined the game`);
      runLoop(id);
    }
  }, 160);
  startTunnel(id);
}

const chatter = ["Saving the game (this may take a moment!)", "Saved the game", "Can't keep up! Is the server overloaded? Running 2034ms or 40 ticks behind"];
const guests = ["Alex", "Notch", "jeb_", "Dinnerbone"];

function runLoop(id: string) {
  clearInterval(timers.get(id));
  let n = 0;
  timers.set(
    id,
    setInterval(() => {
      const st = status(id);
      if (st.state !== "running") return clearInterval(timers.get(id));
      n++;
      if (n % 3 === 0) {
        const guest = guests.find((g) => !st.players.includes(g));
        if (guest && st.players.length < 4) {
          log(id, `${guest}[/127.0.0.1:5${n}12] logged in with entity id ${200 + n} at (12.5, 64.0, -8.5)`);
          log(id, `${guest} joined the game`);
          setStatus(id, { players: [...st.players, guest] });
        } else if (st.players.length > 2) {
          const leaving = st.players[st.players.length - 1];
          log(id, `${leaving} lost connection: Disconnected`);
          log(id, `${leaving} left the game`);
          setStatus(id, { players: st.players.slice(0, -1) });
        }
      } else {
        const text = chatter[n % chatter.length];
        log(id, text, text.startsWith("Can't") ? "warn" : "info");
      }
    }, 3500),
  );
}

function stop(id: string, code = 0) {
  if (status(id).state === "stopped") return;
  clearInterval(timers.get(id));
  setStatus(id, { state: "stopping" });
  log(id, "Stopping the server");
  log(id, "Saving players");
  log(id, "Saving worlds");
  setTimeout(() => {
    log(id, "ThreadedAnvilChunkStorage: All dimensions are saved");
    log(id, `Server beendet (Code ${code})`, "launcher");
    setStatus(id, { state: "stopped", pid: null, players: [], exit_code: code, tunnel: null });
  }, 900);
}

function get(id: unknown): Server {
  const s = servers.get(id as string);
  if (!s) throw { kind: "not_found", message: "Server nicht gefunden" };
  return s;
}

function save(s: Server) {
  servers.set(s.id, s);
  mockEmit("servers://changed", s);
  return s;
}

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function playerAction(id: string, list: ServerPlayerList, action: "add" | "remove", name: string, reason: string | null): ServerPlayers {
  const p = players.get(id) ?? { online: [], whitelist_enabled: false, whitelist: [], ops: [], banned: [], banned_ips: [] };
  if (action === "add") {
    if (list === "banned_ips") {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) throw { kind: "invalid", message: `„${name}“ ist keine gültige IP-Adresse.` };
    } else if (!NAME_RE.test(name) || /unknown|xxx/i.test(name)) {
      throw { kind: "invalid", message: `Den Spieler „${name}“ gibt es nicht (Mojang kennt den Namen nicht).` };
    }
    if (p[list].some((e) => e.name.toLowerCase() === name.toLowerCase())) throw { kind: "invalid", message: `„${name}“ ist schon eingetragen.` };
    p[list] = [...p[list], entry(name, { level: list === "ops" ? 4 : null, reason: list === "banned" || list === "banned_ips" ? reason : null })];
    if (list === "banned") {
      const st = status(id);
      if (st.players.includes(name)) {
        setStatus(id, { players: st.players.filter((x) => x !== name) });
        log(id, `Banned ${name}: ${reason ?? "Banned by an operator."}`);
      }
    }
  } else p[list] = p[list].filter((e) => e.name !== name);
  players.set(id, p);
  return { ...p, online: status(id).players };
}

function candidates(instanceId: string): ServerModCandidate[] {
  const inst = instances.get(instanceId);
  if (!inst || inst.loader.kind === "vanilla") return [];
  const list: [string, string, ServerModCandidate["side"], boolean?][] = [
    ["fabric-api-0.110.5.jar", "Fabric API", "both"],
    ["sodium-fabric-0.6.5.jar", "Sodium", "client"],
    ["iris-fabric-1.8.1.jar", "Iris Shaders", "client"],
    ["lithium-fabric-0.14.3.jar", "Lithium", "both"],
    ["ferritecore-7.1.1.jar", "FerriteCore", "both"],
    ["journeymap-6.0.0.jar", "JourneyMap", "client"],
    ["modmenu-13.0.0.jar", "Mod Menu", "client"],
    ["chunky-1.4.27.jar", "Chunky", "server"],
    ["create-fabric-6.0.4.jar", "Create", "both"],
    ["appleskin-3.0.6.jar", "AppleSkin", "both"],
    ["zoomify-2.14.2.jar", "Zoomify", "client"],
    ["old-mod.jar", null as unknown as string, "unknown", false],
    ["waystones-21.1.5.jar", "Waystones", "both"],
    ["entityculling-1.7.2.jar", "Entity Culling", "client"],
  ];
  return list.map(([file_name, name, side, enabled = true]) => ({ file_name, name, side, enabled, server_ok: side !== "client" && enabled }));
}

// Beim Laden: Survival läuft schon mit zwei Spielern und playit-Claim
setTimeout(() => boot("survival-smp", ["Steve", "Alex"]), 50);

const handlers: Handlers = {
  servers_list: () => [...servers.values()],
  server_get: ({ id }) => get(id),
  server_create: ({ req }) => {
    const r = req as ServerCreate;
    let id = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "server";
    while (servers.has(id)) id += "-2";
    const s = mkServer(id, r.name, {
      mc_version: r.mc_version,
      loader: r.loader,
      port: r.port ?? 25565,
      memory_mb: r.memory_mb ?? null,
      eula: false,
      install_state: "installing",
      created_at: Date.now(),
      source_instance: r.from_instance ?? null,
    });
    save(s);
    props.set(id, defaultProps(s));
    players.set(id, { online: [], whitelist_enabled: false, whitelist: [], ops: [], banned: [], banned_ips: [] });
    worlds.set(id, r.world ? [{ name: "world", size: 24_000_000, active: true }] : []);
    backups.set(id, []);
    const task_id = fakeTask("server-install", `Server „${r.name}“ installieren`, `server:${id}`, 3500, () => save({ ...servers.get(id)!, install_state: "installed" }));
    return { server: s, task_id };
  },
  server_mod_candidates: ({ instanceId }) => candidates(instanceId as string),
  server_update: ({ id, patch }) => {
    const s = get(id);
    const p = patch as ServerPatch;
    const next = save({ ...s, ...p });
    if (p.port !== undefined) props.set(s.id, (props.get(s.id) ?? []).map(([k, v]) => [k, k === "server-port" ? String(p.port) : v]));
    if (p.connection && p.connection !== s.connection && status(s.id).state === "running") {
      if (p.connection === "local") setStatus(s.id, { tunnel: null });
      else startTunnel(s.id);
    }
    return next;
  },
  server_delete: ({ id }) => {
    const s = get(id);
    if (status(s.id).state !== "stopped") throw { kind: "invalid", message: "Der Server läuft noch." };
    servers.delete(s.id);
    mockEmit("servers://removed", { id: s.id });
  },
  server_set_icon: ({ id }) => get(id),
  server_install: ({ id, force }) => {
    const s = get(id);
    return fakeTask("server-install", force ? `Server „${s.name}“ reparieren` : `Server „${s.name}“ installieren`, `server:${s.id}`, 2500, () =>
      save({ ...servers.get(s.id)!, install_state: "installed" }),
    );
  },
  server_accept_eula: ({ id }) => save({ ...get(id), eula: true }),
  server_start: ({ id }) => {
    const s = get(id);
    if (!s.eula) throw { kind: "invalid", message: "Die Minecraft-EULA wurde noch nicht akzeptiert." };
    if (s.install_state === "installing") throw { kind: "invalid", message: "Der Server wird noch installiert." };
    const other = [...servers.values()].find((o) => o.id !== s.id && o.port === s.port && status(o.id).state !== "stopped");
    if (other) throw { kind: "invalid", message: `Port ${s.port} wird schon von „${other.name}“ benutzt.` };
    if (status(s.id).state !== "stopped" && status(s.id).state !== "crashed") return;
    boot(s.id);
  },
  server_stop: ({ id }) => stop(get(id).id),
  server_restart: ({ id }) => {
    const s = get(id);
    stop(s.id);
    setTimeout(() => boot(s.id), 1200);
  },
  server_kill: ({ id }) => {
    const s = get(id);
    clearInterval(timers.get(s.id));
    log(s.id, "Prozess hart beendet", "launcher");
    setStatus(s.id, { state: "stopped", pid: null, players: [], exit_code: -1, tunnel: null });
  },
  server_command: ({ id, command }) => {
    const s = get(id);
    const st = status(s.id);
    if (st.state !== "running") throw { kind: "invalid", message: "Der Server läuft nicht." };
    const c = String(command);
    log(s.id, `> ${c}`, "launcher");
    const [head, ...rest] = c.split(" ");
    if (head === "list") log(s.id, `There are ${st.players.length} of a max of ${st.max_players ?? 20} players online: ${st.players.join(", ")}`);
    else if (head === "save-all") {
      log(s.id, "Saving the game (this may take a moment!)");
      setTimeout(() => log(s.id, "Saved the game"), 400);
    } else if (head === "say") log(s.id, `[Server] ${rest.join(" ")}`);
    else if (head === "kick" && rest[0]) {
      setStatus(s.id, { players: st.players.filter((p) => p !== rest[0]) });
      log(s.id, `Kicked ${rest[0]}: Kicked by an operator`);
    } else if (head === "stop") stop(s.id);
    else if (head === "help") log(s.id, "/advancement, /ban, /ban-ip, /banlist, /clear, /deop, /difficulty, /gamemode, /give, /kick, /list, /op, /say, /stop, /time, /tp, /weather, /whitelist");
    else {
      log(s.id, "Unknown or incomplete command, see below for error", "error");
      log(s.id, `${c}<--[HERE]`, "error");
    }
  },
  server_statuses: () => [...servers.keys()].map(status),
  server_log: ({ id }) => logs.get(id as string) ?? [],
  server_addresses: ({ id }) => {
    const s = get(id);
    return { local: `localhost:${s.port}`, lan: [`192.168.178.24:${s.port}`, `10.0.0.5:${s.port}`] };
  },
  server_properties_get: ({ id }) => props.get(get(id).id) ?? [],
  server_properties_set: ({ id, values }) => {
    const s = get(id);
    const cur = props.get(s.id) ?? [];
    const v = values as Record<string, string>;
    const next: [string, string][] = cur.map(([k, old]) => [k, k in v ? v[k] : old]);
    for (const k of Object.keys(v)) if (!cur.some(([ck]) => ck === k)) next.push([k, v[k]]);
    props.set(s.id, next);
    if ("white-list" in v) players.set(s.id, { ...players.get(s.id)!, whitelist_enabled: v["white-list"] === "true" });
    return next;
  },
  server_properties_raw: ({ id }) => rawOf(get(id).id),
  server_properties_raw_set: ({ id, text }) => {
    const s = get(id);
    const next: [string, string][] = [];
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i === -1) throw { kind: "invalid", message: `Ungültige Zeile: „${line}“ (erwartet schlüssel=wert)` };
      next.push([line.slice(0, i).trim(), line.slice(i + 1)]);
    }
    props.set(s.id, next);
  },
  server_players: ({ id }) => {
    const s = get(id);
    return { ...players.get(s.id)!, online: status(s.id).players };
  },
  server_player_action: ({ id, list, action, name, reason }) =>
    playerAction(get(id).id, list as ServerPlayerList, action as "add" | "remove", String(name), (reason as string | null) ?? null),
  server_set_whitelist: ({ id, enabled }) => {
    const s = get(id);
    players.set(s.id, { ...players.get(s.id)!, whitelist_enabled: !!enabled });
    props.set(s.id, (props.get(s.id) ?? []).map(([k, v]) => [k, k === "white-list" ? String(!!enabled) : v]));
    return { ...players.get(s.id)!, online: status(s.id).players };
  },
  server_worlds: ({ id }) => worlds.get(get(id).id) ?? [],
  server_backups: ({ id }) => backups.get(get(id).id) ?? [],
  server_backup_create: ({ id, world }) => {
    const s = get(id);
    const w = (world as string | null) ?? worlds.get(s.id)?.find((x) => x.active)?.name ?? "world";
    if (status(s.id).state === "running") log(s.id, "Automatic saving is now disabled");
    return fakeTask("server-backup", `Backup von „${w}“`, `server:${s.id}`, 2200, () => {
      const d = new Date();
      const stamp = `${d.toISOString().slice(0, 10)}_${d.toTimeString().slice(0, 5).replace(":", "-")}`;
      backups.set(s.id, [...(backups.get(s.id) ?? []), { name: `${w}-${stamp}.zip`, world: w, size: 120_000_000 + Math.floor(Math.random() * 3e8), created: Date.now() }]);
      if (status(s.id).state === "running") log(s.id, "Automatic saving is now enabled");
    });
  },
  server_backup_delete: ({ id, name }) => {
    const s = get(id);
    backups.set(
      s.id,
      (backups.get(s.id) ?? []).filter((b) => b.name !== name),
    );
  },
  server_backup_restore: ({ id }) => {
    const s = get(id);
    if (status(s.id).state !== "stopped") throw { kind: "invalid", message: "Nur bei gestopptem Server möglich." };
    return fakeTask("server-restore", `Backup wiederherstellen`, `server:${s.id}`, 2000);
  },
  server_open_folder: () => null,
  server_tunnel_reset: ({ id }) => {
    const s = get(id);
    if (s.connection === "relay") relayAddr.delete(s.id);
    else claimed.delete(s.id);
    if (status(s.id).state === "running") startTunnel(s.id);
  },
  servers_quit: ({ stop: doStop }) => {
    console.info("[mock] servers_quit", doStop);
    if (doStop) for (const id of servers.keys()) stop(id);
  },
};

// Hilfen für Tests im Browser: Events auslösen, playit-Claim bestätigen
(window as unknown as { __vlMock: unknown }).__vlMock = {
  emit: mockEmit,
  claim: (id = "survival-smp") => {
    claimed.add(id);
    startTunnel(id);
  },
  closeRequested: () => mockEmit("servers://close-requested", { running: [...statuses.values()].filter((s) => s.state !== "stopped").length }),
};

export default handlers;
