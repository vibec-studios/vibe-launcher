// Mock-Handler Frontend-A (OWNER: Frontend-Agent A): Versionen, Loader, Installieren/Starten mit
// simulierten game://state- und game://log-Events, Logs, mclo.gs, Java, Welten.
import type { ContentItem, JavaInstall, LoaderKind, LogFile, McVersion, World } from "@/lib/types";
import { instances } from "./core";
import { fakeTask, mockEmit, type Handlers } from "./util";
import { latestState, mockFlood, mockKill, mockLaunch, mockSessionLog, states, TEXTS, THREADS } from "./sessions";

// ------------------------------------------------------------------ Versionen

function buildVersions(): McVersion[] {
  const out: McVersion[] = [];
  let d = Date.parse("2026-10-20T10:00:00Z");
  const step = () => (d -= 86400_000 * (9 + ((out.length * 7) % 13)));
  const push = (id: string, kind: McVersion["kind"]) => {
    out.push({ id, kind, release_time: new Date(d).toISOString() });
    step();
  };
  push("26w42a", "snapshot");
  push("26w40a", "snapshot");
  for (let p = 11; p >= 0; p--) {
    if (p === 11) push("1.21.11-rc1", "snapshot");
    push(p ? `1.21.${p}` : "1.21", "release");
    if (p === 5) push("25w14craftmine", "snapshot");
  }
  for (const v of ["1.20.6", "1.20.5", "1.20.4", "1.20.3", "1.20.2", "1.20.1", "1.20"]) push(v, "release");
  push("23w13a_or_b", "snapshot");
  for (const v of [
    "1.19.4",
    "1.19.3",
    "1.19.2",
    "1.19.1",
    "1.19",
    "1.18.2",
    "1.18.1",
    "1.18",
    "1.17.1",
    "1.17",
    "1.16.5",
    "1.16.4",
    "1.16.3",
    "1.16.2",
    "1.16.1",
    "1.16",
  ])
    push(v, "release");
  for (const v of ["1.15.2", "1.15.1", "1.15", "1.14.4", "1.14.3", "1.14.2", "1.14.1", "1.14", "1.13.2", "1.13.1", "1.13", "1.12.2", "1.12.1", "1.12"])
    push(v, "release");
  for (const v of ["1.11.2", "1.11", "1.10.2", "1.10", "1.9.4", "1.9", "1.8.9", "1.8", "1.7.10", "1.7.2", "1.6.4", "1.5.2", "1.4.7", "1.3.2", "1.2.5", "1.0"])
    push(v, "release");
  for (const v of ["b1.8.1", "b1.7.3", "b1.6.6"]) push(v, "old_beta");
  for (const v of ["a1.2.6", "a1.1.2_01"]) push(v, "old_alpha");
  return out;
}
const versions = buildVersions();
const releases = versions.filter((v) => v.kind === "release").map((v) => v.id);
const idx = (id: string) => releases.indexOf(id);

function loaderGameVersions(loader: LoaderKind): string[] {
  switch (loader) {
    case "fabric":
    case "quilt":
      return versions.filter((v) => v.kind === "snapshot" || (v.kind === "release" && idx(v.id) <= idx("1.14"))).map((v) => v.id);
    case "neoforge":
      return releases.filter((v) => idx(v) <= idx("1.20.1"));
    case "forge":
      return releases.filter((v) => idx(v) <= idx("1.5.2") && v !== "1.21.11");
    default:
      return versions.map((v) => v.id);
  }
}

function loaderVersions(loader: LoaderKind, mc: string) {
  switch (loader) {
    case "fabric":
      return ["0.17.3", "0.17.2", "0.16.14", "0.16.10", "0.16.9", "0.15.11", "0.14.25"].map((v) => ({ version: v, stable: true }));
    case "quilt":
      return [
        { version: "0.29.1-beta.2", stable: false },
        { version: "0.29.0", stable: true },
        { version: "0.28.1", stable: true },
        { version: "0.27.1", stable: true },
      ];
    case "neoforge": {
      const [, minor, patch = "0"] = mc.split(".");
      return Array.from({ length: 14 }, (_, i) => ({ version: `${minor}.${patch}.${140 - i * 7}${i === 0 ? "-beta" : ""}`, stable: i !== 0 }));
    }
    case "forge":
      return Array.from({ length: 24 }, (_, i) => ({ version: `${mc}-${50 + Math.floor((24 - i) / 4)}.${(24 - i) % 4}.${i * 3}`, stable: i % 5 !== 0 }));
    default:
      return [];
  }
}

// ------------------------------------------------------------------ Spiel-Simulation (mehrere Sitzungen, siehe sessions.ts)

export { states };

/** Zum Testen in der Konsole: `__mockFlood("survival", 50000)` */
(window as unknown as { __mockFlood: (id: string, n: number) => void }).__mockFlood = mockFlood;

// ------------------------------------------------------------------ Log-Dateien

const now = Date.now();
function logFiles(id: string): LogFile[] {
  const files: LogFile[] = [
    { name: "logs/latest.log", size: 184_220, modified: now - 3600_000, kind: "log" },
    { name: "logs/debug.log", size: 6_812_004, modified: now - 3600_000, kind: "log" },
    { name: "logs/2026-11-16-2.log.gz", size: 24_118, modified: now - 86400_000, kind: "log" },
    { name: "logs/2026-11-16-1.log.gz", size: 19_920, modified: now - 90000_000, kind: "log" },
    { name: "logs/2026-11-12-1.log.gz", size: 31_004, modified: now - 86400_000 * 5, kind: "log" },
  ];
  if (id === "old-forge" || latestState(id)?.crashed)
    files.push({ name: "crash-reports/crash-2026-11-17_14.02.11-client.txt", size: 8_211, modified: now - 600_000, kind: "crash" });
  return files;
}

function fileText(name: string): string {
  if (name.startsWith("crash-reports/"))
    return `---- Minecraft Crash Report ----
// Who set us up the TNT?

Time: 2026-11-17 14:02:11
Description: Ticking entity

java.lang.NullPointerException: Cannot invoke "net.minecraft.class_1297.method_5667()" because "entity" is null
\tat net.minecraft.class_310.method_1514(class_310.java:1312)
\tat net.minecraft.class_310.method_1574(class_310.java:877)
\tat net.minecraft.client.main.Main.main(Main.java:265)

A detailed walkthrough of the error, its code path and all known details is as follows:
---------------------------------------------------------------------------------------

-- Head --
Thread: Render thread
Stacktrace:
\tat net.minecraft.class_310.method_1514(class_310.java:1312)

-- System Details --
Details:
\tMinecraft Version: 1.12.2
\tOperating System: Windows 11 (amd64) version 10.0
\tJava Version: 1.8.0_422, Temurin
\tMemory: 812739584 bytes (775 MiB) / 2147483648 bytes (2048 MiB) up to 4294967296 bytes (4096 MiB)
\tLaunched Version: forge-14.23.5.2860
`;
  const n = name === "logs/debug.log" ? 50_000 : 400;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const [lvl, txt] = TEXTS[(i * 5) % TEXTS.length];
    const s = 10 + (i % 50);
    const time = `14:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    out.push(`[${time}] [${THREADS[i % THREADS.length]}/${lvl.toUpperCase()}]: ${txt}${n > 1000 ? ` (${i})` : ""}`);
    if (lvl === "error")
      out.push("java.io.FileNotFoundException: hh-armors:textures/item/void_blade_glow.png", "\tat net.minecraft.class_3300.method_14486(class_3300.java:71)");
  }
  return out.join("\n");
}

// ------------------------------------------------------------------ Java

const java: JavaInstall[] = [
  {
    path: "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.5.11-hotspot\\bin\\javaw.exe",
    version: "21.0.5",
    major: 21,
    vendor: "Eclipse Adoptium",
    arch: "x86_64",
    managed: false,
  },
  {
    path: "C:\\Users\\steve\\AppData\\Roaming\\VibeLauncher\\java\\17\\bin\\javaw.exe",
    version: "17.0.13",
    major: 17,
    vendor: "Temurin",
    arch: "x86_64",
    managed: true,
  },
  { path: "C:\\Program Files\\Java\\jre1.8.0_421\\bin\\javaw.exe", version: "1.8.0_421", major: 8, vendor: "Oracle", arch: "x86_64", managed: false },
];

// ------------------------------------------------------------------ Welten

const worlds = new Map<string, World[]>([
  [
    "survival",
    [
      { folder: "Neue Welt", name: "Neue Welt", last_played: now - 3600_000, game_mode: "survival", icon: null, size: 184_000_000 },
      { folder: "Bauwelt", name: "Bauwelt (Kreativ)", last_played: now - 86400_000 * 4, game_mode: "creative", icon: null, size: 42_500_000 },
      { folder: "Hardcore-1", name: "Hardcore #1", last_played: now - 86400_000 * 30, game_mode: "hardcore", icon: null, size: 12_900_000 },
    ],
  ],
  ["hh-armors", [{ folder: "Test", name: "Boss-Arena", last_played: now - 86400_000 * 2, game_mode: "creative", icon: null, size: 8_400_000 }]],
]);

function mods(id: string): ContentItem[] {
  const n = id === "survival" ? 84 : id === "hh-armors" ? 23 : id === "all-the-mods" ? 412 : 9;
  return Array.from({ length: n }, (_, i) => ({
    file_name: `mod-${i}.jar`,
    pinned: false,
    side: "unknown",
    kind: "mod",
    enabled: true,
    name: `Mod ${i}`,
    version: "1.0.0",
    description: null,
    authors: [],
    icon: null,
    source: null,
    project_id: null,
    version_id: null,
    size: 100_000,
    modified: now,
  }));
}

// ------------------------------------------------------------------ Handler

const handlers: Handlers = {
  game_versions: () => versions,
  loader_game_versions: ({ loader }) => loaderGameVersions(loader as LoaderKind),
  loader_versions: ({ loader, mcVersion }) => loaderVersions(loader as LoaderKind, mcVersion as string),
  instance_install: ({ id }) => {
    const inst = instances.get(id as string);
    if (!inst) throw { kind: "not_found", message: "Instanz nicht gefunden" };
    const installing = { ...inst, install_state: "installing" as const };
    instances.set(inst.id, installing);
    mockEmit("instance://changed", installing);
    return fakeTask("install", `Installiere ${inst.name}`, inst.id, 3500, () => {
      const done = { ...instances.get(inst.id)!, install_state: "installed" as const };
      instances.set(inst.id, done);
      mockEmit("instance://changed", done);
    });
  },
  instance_launch: (args) => {
    const { id, accountId, offline } = args;
    let off = false;
    try {
      off = localStorage.getItem("mock.offline") === "1";
    } catch {}
    if (off && !offline) {
      setTimeout(() => mockEmit("auth://offline-available", { instance_id: id as string, account_id: (accountId as string | null) ?? null, message: "Microsoft nicht erreichbar" }), 400);
      return "mock-offline";
    }
    return mockLaunch(id as string, (accountId as string | null) ?? null, (args.world as string | null) ?? null);
  },
  instance_kill: ({ id, runId }) => mockKill(id as string, (runId as string | null) ?? null),
  console_open: ({ runId }) => {
    try {
      const query = typeof runId === "string" ? `?run=${encodeURIComponent(runId)}` : "";
      window.open(`/console.html${query}`, "_blank", "width=980,height=600");
    } catch {}
  },
  game_states: () => [...states.values()],
  instance_log_session: ({ id, runId }) => mockSessionLog(id as string, (runId as string | null) ?? null),
  instance_log_files: ({ id }) => logFiles(id as string),
  instance_log_read: ({ name }) => fileText(name as string),
  mclogs_upload: ({ content }) => {
    const id = Math.random().toString(36).slice(2, 9);
    return { id, url: `https://mclo.gs/${id}`, raw: `https://api.mclo.gs/1/raw/${id}`, size: String(content).length };
  },
  java_list: () => java,
  java_test: ({ path }) => {
    const p = String(path);
    const known = java.find((j) => j.path === p);
    if (known) return known;
    if (/java/i.test(p)) return { path: p, version: "21.0.2", major: 21, vendor: "Microsoft", arch: "x86_64", managed: false };
    throw { kind: "invalid", message: `Unter „${p}“ wurde keine gültige Java-Installation gefunden.` };
  },
  java_install: ({ major }) =>
    fakeTask("java", `Java ${major} herunterladen`, null, 3000, () => {
      if (!java.some((j) => j.major === major && j.managed))
        java.push({
          path: `C:\\Users\\steve\\AppData\\Roaming\\VibeLauncher\\java\\${major}\\bin\\javaw.exe`,
          version: `${major}.0.1`,
          major: major as number,
          vendor: "Temurin",
          arch: "x86_64",
          managed: true,
        });
    }),
  worlds_list: ({ instanceId }) => worlds.get(instanceId as string) ?? [],
  world_delete: ({ instanceId, folder }) => {
    worlds.set(
      instanceId as string,
      (worlds.get(instanceId as string) ?? []).filter((w) => w.folder !== folder),
    );
    mockEmit("content://changed", { instance_id: instanceId as string });
  },
  content_list: ({ instanceId, kind }) => (kind === "mod" ? mods(instanceId as string) : []),
};

export default handlers;
