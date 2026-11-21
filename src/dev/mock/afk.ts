import { emit } from "@tauri-apps/api/event";
import type { AfkEvent, AfkSession, AfkSupport } from "@/features/afk/types";
import { instances } from "./core";
import { runsOf, states } from "./sessions";
import type { Handlers } from "./util";

const sessions = new Map<string, AfkSession>();
const events = new Map<string, AfkEvent[]>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
const pending = new Set<string>();

const CHAT = [
  "<Alex> hat jemand Eisen übrig?",
  "<Notch> gg",
  "Alex joined the game",
  "<Mia> wer ist alles afk?",
  "<Alex> ich farm kurz bei der Eisenfarm",
  "Mia has made the advancement [Getting an Upgrade]",
];

function modern(mc: string) {
  const m = /^1\.(\d+)/.exec(mc);
  return m ? Number(m[1]) >= 13 : !/^[abc]/.test(mc);
}

function flag(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function publish(s: AfkSession) {
  sessions.set(s.run_id, s);
  void emit("afk://session", s);
}

function push(runId: string, e: AfkEvent) {
  const s = sessions.get(runId);
  if (!s) return;
  const list = events.get(runId) ?? [];
  list.push(e);
  if (list.length > 500) list.splice(0, list.length - 500);
  events.set(runId, list);
  void emit("afk://event", { run_id: runId, instance_id: s.instance_id, event: e });
  publish({ ...s, events: list.length });
}

function update(runId: string, patch: Partial<AfkSession>) {
  const s = sessions.get(runId);
  if (s) publish({ ...s, ...patch });
}

function simulate(runId: string, agent: boolean) {
  let n = 0;
  clearInterval(timers.get(runId));
  timers.set(
    runId,
    setInterval(() => {
      const st = states.get(runId);
      if (!st || st.state === "stopped") {
        clearInterval(timers.get(runId));
        update(runId, { ended: true, window_hidden: false });
        return;
      }
      n++;
      if (n === 2 && agent) {
        push(runId, { ts: Date.now(), type: "agent_start", agent_version: "0.1.0" });
        update(runId, {
          agent: "active",
          agent_version: "0.1.0",
          features: { window: true, fps: true, sound: true, chat_read: true, chat_send: true, reconnect: true, game_state: true },
          can_send: true,
          window: "agent",
          window_hidden: sessions.get(runId)?.mode === "background",
        });
      }
      if (n % 3 === 0) {
        const text = CHAT[(n / 3) % CHAT.length];
        const sender = /^<(\w+)>/.exec(text)?.[1];
        push(runId, { ts: Date.now(), type: "chat", text, sender, kind: sender ? "chat" : "system", source: "log" as const, ...(agent ? {} : { fallback: true }) });
      }
      if (n % 5 === 0) {
        const s = sessions.get(runId);
        const health = Math.max(4, 20 - (n % 17));
        if (s) update(runId, { status: { ...s.status, connected: true, server: st.server ?? "play.example.org", health, max_health: 20, food: 17, updated_at: Date.now() } });
      }
      if (n === 14) push(runId, { ts: Date.now(), type: "mention", text: `<Mia> ${st.account_name ?? "Steve"}, bist du da?`, sender: "Mia" });
      if (n === 26) push(runId, { ts: Date.now(), type: "health_low", health: 5, max_health: 20 });
    }, 1000),
  );
}

function create(runId: string, background: boolean) {
  const st = states.get(runId);
  if (!st) throw { kind: "invalid", message: "Diese Sitzung läuft nicht." };
  const inst = instances.get(st.instance_id);
  const agent = background && !!inst && modern(inst.mc_version);
  const s: AfkSession = {
    run_id: runId,
    instance_id: st.instance_id,
    requested: background,
    mode: background ? "background" : "foreground",
    mode_at: Date.now(),
    agent: !inst || !modern(inst.mc_version) ? "unsupported" : agent ? "pending" : "missing",
    agent_version: agent ? "0.1.0" : null,
    features: { window: false, fps: false, sound: false, chat_read: false, chat_send: false, reconnect: false },
    window: background ? "system" : null,
    window_hidden: background,
    overlay: background && !agent,
    can_send: false,
    status: st.server ? { server: st.server } : {},
    events: 0,
    ended: false,
  };
  events.set(runId, []);
  publish(s);
  simulate(runId, agent);
  return s;
}

function startWhenRunning(runId: string) {
  const tick = setInterval(() => {
    const st = states.get(runId);
    if (!st || st.state === "stopped") return clearInterval(tick);
    if (st.state === "running") {
      clearInterval(tick);
      pending.delete(runId);
      create(runId, true);
    }
  }, 300);
}

export function afkMock(base: Handlers): Handlers {
  const launch = base.instance_launch;
  return {
    instance_launch: async (args) => {
      const r = await launch(args);
      if (args.afk) {
        const run = runsOf(args.id as string).filter((s) => s.state !== "stopped").pop();
        if (run) {
          pending.add(run.run_id);
          startWhenRunning(run.run_id);
        }
      }
      return r;
    },
    afk_support: ({ instanceId }): AfkSupport => {
      const inst = instances.get(instanceId as string);
      const ok = !!inst && modern(inst.mc_version);
      if (inst?.bedrock) return { supported: false, agent: "none", agent_version: null, window: "none", fps: "none", sound: "none", chat_read: "none", chat_send: false, reconnect: false };
      return ok
        ? { supported: true, agent: flag("vl.mock.afk.ready") ? "ready" : "download", agent_version: flag("vl.mock.afk.ready") ? "0.1.0" : null, window: "agent", fps: "agent", sound: "agent", chat_read: "agent", chat_send: true, reconnect: true }
        : { supported: true, agent: "download", agent_version: null, window: "system", fps: "agent", sound: "agent", chat_read: "agent", chat_send: false, reconnect: false };
    },
    afk_sessions: () => [...sessions.values()],
    afk_events: ({ runId }) => events.get(runId as string)?.slice() ?? [],
    afk_set_background: ({ runId, background }) => {
      const id = runId as string;
      const cur = sessions.get(id);
      if (!cur || cur.ended) {
        const s = create(id, false);
        if (!background) return s;
        publish({ ...s, mode: "background", requested: true, window: "system", window_hidden: true, mode_at: Date.now() });
        return sessions.get(id);
      }
      const viaAgent = cur.agent === "active";
      publish({ ...cur, mode: background ? "background" : "foreground", requested: cur.requested || !!background, mode_at: Date.now(), window: viaAgent ? "agent" : "system", window_hidden: !!background });
      if (viaAgent) push(id, { ts: Date.now(), type: "mode", mode: background ? "background" : "foreground", window: true, fps: 2, muted: !!background });
      return sessions.get(id);
    },
    afk_send: ({ runId, text }) => {
      const id = runId as string;
      const s = sessions.get(id);
      if (!s?.can_send) throw { kind: "invalid", message: "Nachrichten senden geht nur mit geladenem AFK-Agent." };
      const t = String(text).trim();
      if (!t || t.length > 256) throw { kind: "invalid", message: "Die Nachricht ist leer oder zu lang." };
      const mid = Math.random().toString(36).slice(2);
      push(id, { ts: Date.now(), type: "outgoing", id: mid, text: t });
      setTimeout(() => {
        push(id, { ts: Date.now(), type: "outbox_ack", id: mid, ok: true });
        if (!t.startsWith("/")) push(id, { ts: Date.now(), type: "chat", text: `<${states.get(id)?.account_name ?? "Steve"}> ${t}`, sender: states.get(id)?.account_name ?? "Steve", kind: "chat" });
      }, 500);
      return mid;
    },
  };
}

function seed() {
  const spec = flag("vl.mock.afk");
  if (!spec) return;
  for (const id of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const run = runsOf(id).find((s) => s.state === "running");
    if (!run) continue;
    const s = create(run.run_id, true);
    const list = events.get(run.run_id)!;
    const t0 = Date.now() - 600_000;
    const hist: AfkEvent[] = [
      { ts: t0, type: "agent_start", agent_version: "0.1.0" },
      { ts: t0 + 20_000, type: "connect", server: "play.example.org" },
      { ts: t0 + 30_000, type: "chat", text: "<Alex> willkommen zurück!", sender: "Alex", kind: "chat" },
      { ts: t0 + 90_000, type: "chat", text: "Mia joined the game", kind: "system" },
      { ts: t0 + 120_000, type: "chat", text: "Alex whispers to you: kommst du nachher zur Basis?", sender: "Alex", kind: "whisper" },
      { ts: t0 + 120_000, type: "whisper", text: "Alex whispers to you: kommst du nachher zur Basis?", sender: "Alex" },
      { ts: t0 + 300_000, type: "death", message: `${run.account_name ?? "Steve"} was slain by Zombie` },
      { ts: t0 + 420_000, type: "disconnect", server: "play.example.org", reason: "Du warst zu lange AFK" },
      { ts: t0 + 450_000, type: "reconnect_attempt", attempt: 1, delay_s: 10, server: "play.example.org" },
      { ts: t0 + 462_000, type: "connect", server: "play.example.org" },
    ];
    list.push(...hist);
    const modernInst = s.agent !== "unsupported";
    publish({
      ...s,
      agent: modernInst ? "active" : "unsupported",
      agent_version: modernInst ? "0.1.0" : null,
      features: modernInst ? { window: true, fps: true, sound: true, chat_read: true, chat_send: true, reconnect: true, game_state: true } : s.features,
      can_send: modernInst,
      window: modernInst ? "agent" : "system",
      overlay: !modernInst,
      status: { connected: true, server: "play.example.org", health: 14, max_health: 20, food: 18, updated_at: Date.now() },
      events: list.length,
    });
  }
}

setTimeout(seed, 50);
