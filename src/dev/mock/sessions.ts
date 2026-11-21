import type { GameState, LogLine, LogLevel } from "@/lib/types";
import { instances } from "./core";
import { mockAccountList } from "./b";
import { fakeTask, mockEmit, tasks } from "./util";

export const states = new Map<string, GameState>();
const session = new Map<string, LogLine[]>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
const seqs = new Map<string, number>();
let counter = 0;

export const THREADS = ["Render thread", "Server thread", "Worker-Main-3", "main", "Netty Client IO #1", "Sound engine"];
const LOGGERS = ["net.minecraft.client.Minecraft", "FabricLoader", "Iris", "Sodium", "ModernFix", "net.minecraft.server.MinecraftServer", "Mixin"];
export const TEXTS: [LogLevel, string][] = [
  ["info", "Loaded 127 recipes"],
  ["info", "Reloading ResourceManager: vanilla, fabric, sodium, iris, hh-armors"],
  ["info", "Sound engine started"],
  ["info", "Created: 1024x1024x4 minecraft:textures/atlas/blocks.png-atlas"],
  ["warn", "Missing sound for event: minecraft:item.goat_horn.play"],
  ["info", "Connecting to localhost, 25565"],
  ["debug", "Received chunk packet for [12, -4] (16 sections)"],
  ["info", "[CHAT] Steve joined the game"],
  ["warn", "Can't keep up! Is the server overloaded? Running 2143ms or 42 ticks behind"],
  ["info", "Saving chunks for level 'ServerLevel[Neue Welt]'/minecraft:overworld"],
  ["error", "Failed to load texture hh-armors:textures/item/void_blade_glow.png"],
  ["info", "Preparing spawn area: 84%"],
  ["debug", "Uploading chunk mesh batch (64 sections) in 3.2 ms"],
  ["info", "Shader pack 'Complementary Reimagined r5.4' loaded in 812 ms"],
];

export function mockLine(run: string, level: LogLevel, text: string, now = new Date()): LogLine {
  const seq = (seqs.get(run) ?? 0) + 1;
  seqs.set(run, seq);
  return {
    seq,
    time: now.toTimeString().slice(0, 8),
    level,
    thread: level === "launcher" ? null : THREADS[seq % THREADS.length],
    logger: level === "launcher" ? null : LOGGERS[seq % LOGGERS.length],
    text,
  };
}

export function pushLines(run: string, lines: LogLine[]) {
  const st = states.get(run);
  if (!st) return;
  const buf = session.get(run) ?? [];
  buf.push(...lines);
  if (buf.length > 50_000) buf.splice(0, buf.length - 50_000);
  session.set(run, buf);
  mockEmit("game://log", { run_id: run, instance_id: st.instance_id, lines });
}

function setState(s: GameState) {
  states.set(s.run_id, s);
  mockEmit("game://state", s);
}

const active = (s: GameState) => s.state !== "stopped";

export function runsOf(instanceId: string) {
  return [...states.values()].filter((s) => s.instance_id === instanceId);
}

export function latestState(instanceId: string): GameState | undefined {
  const list = runsOf(instanceId);
  return list.find((s) => s.state === "running") ?? list.find(active) ?? list[list.length - 1];
}

export function resolveRun(key: string): string | undefined {
  if (states.has(key)) return key;
  return latestState(key)?.run_id;
}

export function emptyState(instanceId: string, extra: Partial<GameState> = {}): GameState {
  counter++;
  return {
    run_id: `run-${counter}`,
    instance_id: instanceId,
    slot: 1,
    state: "stopped",
    pid: null,
    created_at: Date.now(),
    started_at: null,
    ended_at: null,
    exit_code: null,
    crashed: false,
    crash_report: null,
    account_name: null,
    account_uuid: null,
    world: null,
    server: null,
    ...extra,
  };
}

function stop(run: string, crashed = false) {
  clearInterval(timers.get(run));
  timers.delete(run);
  const prev = states.get(run);
  if (!prev) return;
  const id = prev.instance_id;
  const inst = instances.get(id);
  const othersRunning = runsOf(id).some((s) => s.run_id !== run && s.state === "running");
  if (inst && prev.started_at && !othersRunning) {
    const first = Math.min(prev.started_at, ...runsOf(id).filter((s) => s.started_at && s.ended_at && s.ended_at >= prev.started_at!).map((s) => s.started_at!));
    const next = { ...inst, last_played: Date.now(), play_time_secs: inst.play_time_secs + Math.round((Date.now() - first) / 1000) };
    instances.set(id, next);
    mockEmit("instance://changed", next);
  }
  if (crashed) {
    pushLines(run, [
      mockLine(run, "error", "Unreported exception thrown!"),
      mockLine(run, "fatal", 'java.lang.NullPointerException: Cannot invoke "net.minecraft.class_1297.method_5667()" because "entity" is null'),
      { ...mockLine(run, "stderr", "\tat net.minecraft.class_310.method_1514(class_310.java:1312)"), time: null },
      { ...mockLine(run, "stderr", "\tat net.minecraft.client.main.Main.main(Main.java:265)"), time: null },
      mockLine(run, "launcher", "Spiel abgestürzt (Exit-Code -1). Crash-Report: crash-reports/crash-2026-11-17_14.02.11-client.txt"),
    ]);
  } else pushLines(run, [mockLine(run, "launcher", prev.state === "preparing" ? "Start abgebrochen." : "Spiel beendet (Exit-Code 0)")]);
  setState({
    ...prev,
    state: "stopped",
    pid: null,
    ended_at: Date.now(),
    exit_code: prev.state === "preparing" ? null : crashed ? -1 : 0,
    crashed,
    crash_report: crashed ? `C:\\Users\\steve\\AppData\\Roaming\\VibeLauncher\\instances\\${id}\\minecraft\\crash-reports\\crash-2026-11-17_14.02.11-client.txt` : null,
  });
}

function startRunning(run: string, crash: boolean) {
  const st = states.get(run);
  if (!st) return;
  const inst = instances.get(st.instance_id);
  if (!inst) return;
  setState({ ...st, state: "running", pid: 12000 + counter * 7, started_at: Date.now() });
  pushLines(run, [
    mockLine(run, "launcher", "Java: C:\\Users\\steve\\AppData\\Roaming\\VibeLauncher\\java\\21\\bin\\javaw.exe (21.0.5, Temurin)"),
    mockLine(run, "launcher", "Startbefehl: javaw -Xms512M -Xmx4096M -XX:+UseG1GC … net.fabricmc.loader.impl.launch.knot.KnotClient"),
    mockLine(run, "info", `Loading Minecraft ${inst.mc_version} with Fabric Loader 0.17.2`),
    mockLine(run, "info", "Loading 84 mods:"),
    ...Array.from({ length: 30 }, (_, i) => ({ ...mockLine(run, "info", `\t- mod-${i + 1} ${1 + (i % 4)}.${i % 10}.${i}`), time: null })),
  ]);
  let n = 0;
  timers.set(
    run,
    setInterval(() => {
      n++;
      const batch = Array.from({ length: 1 + (n % 4) }, (_, k) => {
        const [lvl, txt] = TEXTS[(n * 3 + k + st.slot) % TEXTS.length];
        return mockLine(run, lvl, txt);
      });
      pushLines(run, batch);
      if (crash && n === 30) stop(run, true);
    }, 140),
  );
}

export function mockLaunch(id: string, accountId?: string | null, world?: string | null, opts: { instant?: boolean; ageMs?: number } = {}): string {
  const inst = instances.get(id);
  if (!inst) throw { kind: "not_found", message: "Instanz nicht gefunden" };
  if (world && runsOf(id).some((s) => active(s) && s.world === world)) throw { kind: "invalid", message: `Die Welt „${world}“ ist bereits geöffnet.` };
  for (const s of runsOf(id)) if (!active(s)) states.delete(s.run_id);
  const used = new Set(runsOf(id).filter(active).map((s) => s.slot));
  let slot = 1;
  while (used.has(slot)) slot++;
  const accounts = mockAccountList();
  const acc = accounts.find((a) => a.id === accountId) ?? accounts.find((a) => a.active) ?? accounts[0];
  const st = emptyState(id, { slot, state: "preparing", created_at: Date.now() - (opts.ageMs ?? 0), account_name: acc?.username ?? null, account_uuid: acc?.uuid ?? null, world: world ?? null });
  const run = st.run_id;
  seqs.set(run, 0);
  session.set(run, []);
  setState(st);
  pushLines(run, [mockLine(run, "launcher", `Bereite ${inst.name}${slot > 1 ? ` (Sitzung #${slot})` : ""} vor (Minecraft ${inst.mc_version}, ${inst.loader.kind})`)]);
  if (slot > 1) pushLines(run, [mockLine(run, "launcher", "Die Instanz läuft bereits – automatische Updates und Welt-Backups werden für diese weitere Sitzung übersprungen.")]);
  const busy = acc && [...states.values()].find((s) => s.run_id !== run && active(s) && s.account_uuid === acc.uuid);
  if (busy) pushLines(run, [mockLine(run, "warn", `Achtung: ${acc.username} spielt bereits in „${instances.get(busy.instance_id)?.name ?? busy.instance_id}“ (Sitzung #${busy.slot}).`)]);
  const crash = inst.loader.kind === "forge";
  if (opts.instant) {
    startRunning(run, crash);
    const cur = states.get(run);
    if (cur && opts.ageMs) setState({ ...cur, started_at: Date.now() - opts.ageMs });
    return run;
  }
  const task = fakeTask("launch", `Starte ${inst.name}`, id, 2200, () => {
    if (inst.install_state !== "installed") {
      const next = { ...instances.get(id)!, install_state: "installed" as const };
      instances.set(id, next);
      mockEmit("instance://changed", next);
    }
    if (states.get(run)?.state === "preparing") startRunning(run, crash);
  });
  taskOf.set(run, task);
  return task;
}

const taskOf = new Map<string, string>();

export function mockKill(id: string, runId?: string | null) {
  const runs = runId && states.get(runId)?.instance_id === id ? [runId] : runsOf(id).filter(active).map((s) => s.run_id);
  for (const run of runs) {
    const t = taskOf.get(run);
    const task = t ? tasks.get(t) : undefined;
    if (states.get(run)?.state === "preparing" && task?.status === "running") {
      const c = { ...task, status: "cancelled" as const };
      tasks.set(task.id, c);
      mockEmit("task://update", c);
    }
    stop(run);
  }
}

export function mockSessionLog(id: string, runId?: string | null): LogLine[] {
  const run = resolveRun((runId as string) || id);
  return run ? (session.get(run) ?? []) : [];
}

export function mockFlood(id: string, n: number) {
  const run = resolveRun(id);
  if (!run) return;
  const lines: LogLine[] = [];
  for (let i = 0; i < n; i++) {
    const [lvl, txt] = TEXTS[i % TEXTS.length];
    lines.push(mockLine(run, lvl, `${txt} #${i}`));
  }
  pushLines(run, lines);
}

function seed() {
  let spec: string | null = null;
  try {
    spec = localStorage.getItem("vl.mock.sessions");
  } catch {
    return;
  }
  if (!spec) return;
  const accounts = mockAccountList();
  spec.split(",").forEach((entry, i) => {
    const [id, acc] = entry.trim().split(":");
    if (!id || !instances.has(id)) return;
    const accountId = acc ? (accounts[Number(acc)]?.id ?? null) : null;
    mockLaunch(id, accountId, null, { instant: true, ageMs: (40 - i * 9) * 60_000 });
  });
}

setTimeout(seed, 0);
