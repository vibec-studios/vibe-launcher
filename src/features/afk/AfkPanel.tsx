import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Server, Cpu, Heart, MemoryStick, Monitor, MoonStar, Send, ShieldAlert, Square, Timer, Utensils, Wifi, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { formatUptime } from "@/lib/sessions";
import type { GameState, RunResources } from "@/lib/types";
import { afkApi } from "./api";
import { at } from "./liteText";
import { isBackground, useAfkEvents, useAfkStore } from "./store";
import type { AfkEvent, AfkSession } from "./types";
import { CHAT_TYPES, NOTABLE_TYPES } from "./types";

function useResources(runId: string) {
  const [r, setR] = useState<RunResources | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () =>
      api
        .gameResources()
        .then((l) => !dead && setR(l.find((x) => x.run_id === runId) ?? null))
        .catch(() => {});
    load();
    const id = setInterval(load, 3000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [runId]);
  return r;
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-ctl bg-surface px-2.5 py-1.5">
      <span className={`shrink-0 ${tone ?? "text-muted"}`}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className="block text-[10.5px] uppercase tracking-wide text-dim">{label}</span>
        <span className="block truncate text-[12.5px] font-medium text-text">{value}</span>
      </span>
    </div>
  );
}

const time = (ts: number) => new Date(ts).toTimeString().slice(0, 5);

function ChatLine({ e, me }: { e: AfkEvent; me?: string | null }) {
  const mine = e.type === "outgoing" || (!!me && e.sender === me);
  const whisper = e.kind === "whisper";
  return (
    <div className={`flex gap-2 px-3 py-0.5 text-[12.5px] leading-relaxed ${whisper ? "bg-brand/10" : ""}`}>
      <span className="shrink-0 tabular-nums text-dim">{time(e.ts)}</span>
      <span className={`min-w-0 break-words ${mine ? "text-accent" : e.kind === "system" ? "text-muted" : "text-text"}`}>{e.type === "outgoing" ? `${at("afk.you")}: ${e.text}` : e.text}</span>
    </div>
  );
}

const EV_TONE: Record<string, string> = {
  death: "text-danger",
  disconnect: "text-danger",
  reconnect_gave_up: "text-danger",
  mention: "text-brand",
  whisper: "text-brand",
  health_low: "text-warn",
  food_low: "text-warn",
  error: "text-warn",
};

function eventLabel(e: AfkEvent) {
  if (e.type === "outbox_ack") return at(e.ok === false ? "afk.ev.sent_failed" : "afk.ev.outbox_ack");
  if (e.type === "disconnect" && e.left) return at("afk.ev.left");
  if (e.type === "reconnect_attempt") return at("afk.ev.reconnect_attempt", { n: e.attempt ?? 1 });
  return at(`afk.ev.${e.type}`);
}

function eventDetail(e: AfkEvent): string {
  if (e.type === "health_low" && e.health !== undefined) return `${Math.round(e.health)} / ${e.max_health ?? 20}`;
  if (e.type === "food_low" && e.food !== undefined) return `${e.food} / 20`;
  if (e.type === "outbox_ack") return e.error ?? "";
  if (e.type === "connect") return (e.server as string | null) ?? "";
  if (e.type === "chat_dropped") return String(e.count ?? "");
  return (e.message ?? e.reason ?? (e.type === "mention" || e.type === "whisper" ? e.text : undefined) ?? "") as string;
}

function EventLine({ e }: { e: AfkEvent }) {
  const failed = e.type === "outbox_ack" && e.ok === false;
  const detail = eventDetail(e);
  return (
    <div className="border-b border-line px-3 py-1.5 last:border-0">
      <div className="flex items-center gap-2 text-[12px]">
        <span className={`font-semibold ${failed ? "text-danger" : e.type === "disconnect" && e.left ? "text-text" : (EV_TONE[e.type] ?? "text-text")}`}>{eventLabel(e)}</span>
        <span className="ml-auto tabular-nums text-dim">{time(e.ts)}</span>
      </div>
      {detail && <div className="mt-0.5 break-words text-[11.5px] text-muted">{detail}</div>}
    </div>
  );
}

function Composer({ session }: { session: AfkSession }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session.can_send) {
    return <div className="border-t border-line px-3 py-2 text-[12px] text-muted">{at("afk.chat.need_agent")}</div>;
  }
  const send = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      await afkApi.send(session.run_id, v);
      setText("");
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    }
    setBusy(false);
  };
  return (
    <div className="border-t border-line p-2">
      <div className="flex gap-1.5">
        <input
          value={text}
          maxLength={256}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={at("afk.chat.ph")}
          aria-label={at("afk.chat.ph")}
          className="h-8 min-w-0 flex-1 rounded-ctl bg-surface2 px-2.5 text-[12.5px] text-text outline-none placeholder:text-dim focus:ring-1 focus:ring-accent"
        />
        <button
          disabled={!text.trim() || busy}
          onClick={send}
          className="flex h-8 items-center gap-1.5 rounded-ctl bg-accent px-3 text-[12.5px] font-semibold text-[var(--on-accent)] hover:brightness-110 disabled:opacity-40"
        >
          <Send size={13} />
          {at("afk.chat.send")}
        </button>
      </div>
      {error && <div className="mt-1 text-[11.5px] text-danger">{at("afk.chat.failed")}: {error}</div>}
    </div>
  );
}

export function AfkPanel({ run, session }: { run: GameState; session: AfkSession | undefined }) {
  const events = useAfkEvents(run.run_id, !!session);
  const res = useResources(run.run_id);
  const [now, setNow] = useState(() => Date.now());
  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const chat = useMemo(() => events.filter((e) => CHAT_TYPES.has(e.type)), [events]);
  const notable = useMemo(() => events.filter((e) => NOTABLE_TYPES.has(e.type) && !(e.type === "outbox_ack" && e.ok !== false)).slice().reverse(), [events]);
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);
  const toggle = async (bg: boolean) => {
    try {
      useAfkStore.getState().setSession(await afkApi.setBackground(run.run_id, bg));
    } catch {}
  };
  const running = run.state === "running";

  if (!session) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center" data-testid="afk-panel-empty">
        <div className="max-w-[420px]">
          <MoonStar size={28} className="mx-auto mb-3 text-dim" />
          <div className="text-[13.5px] text-muted">{running ? at("afk.not_tracked") : at("afk.ended")}</div>
          {running && (
            <button onClick={() => toggle(true)} className="mx-auto mt-3 flex h-8 items-center gap-1.5 rounded-ctl bg-accent px-3 text-[12.5px] font-semibold text-[var(--on-accent)] hover:brightness-110">
              <MoonStar size={13} />
              {at("afk.to_bg")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const bg = isBackground(session);
  const st = session.status;
  const conn = st.connected === true ? at("afk.status.connected") : st.connected === false ? at("afk.status.disconnected") : at("afk.status.unknown");
  const where = st.server ?? st.world ?? (st.connected === false ? "–" : at("afk.status.menu"));
  const fromLog = session.agent !== "active" && session.agent !== "pending";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2" data-testid="afk-panel">
      <div className="flex flex-wrap items-center gap-2 rounded-card bg-surface2 px-3 py-2">
        <span className={`flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[12px] font-semibold ${bg ? "bg-brand/15 text-brand" : "bg-surface3 text-text"}`}>
          {bg ? <MoonStar size={12} /> : <Monitor size={12} />}
          {at(bg ? "afk.state.background" : "afk.state.foreground")}
        </span>
        <span className="text-[12px] text-muted">{at(`afk.agent_state.${session.agent}`)}{session.agent_version ? ` ${session.agent_version}` : ""}</span>
        <div className="ml-auto flex gap-1.5">
          {!session.ended && running && (
            <button
              data-testid="afk-toggle"
              onClick={() => toggle(!bg)}
              className="flex h-8 items-center gap-1.5 rounded-ctl bg-accent px-3 text-[12.5px] font-semibold text-[var(--on-accent)] hover:brightness-110"
            >
              {bg ? <Monitor size={13} /> : <MoonStar size={13} />}
              {at(bg ? "afk.to_fg" : "afk.to_bg")}
            </button>
          )}
          <button
            disabled={session.ended || run.state === "stopped"}
            onClick={() => api.instanceKill(run.instance_id, run.run_id).catch(() => {})}
            className="flex h-8 items-center gap-1.5 rounded-ctl bg-danger/12 px-3 text-[12.5px] font-medium text-danger hover:bg-danger hover:text-black disabled:opacity-40"
          >
            <Square size={11} fill="currentColor" />
            {at("afk.stop")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
        <Stat icon={st.connected === false ? <WifiOff size={14} /> : <Wifi size={14} />} tone={st.connected === false ? "text-danger" : st.connected ? "text-ok" : undefined} label={at("afk.status.connection")} value={conn} />
        <Stat icon={<Server size={14} />} label={at(st.world && !st.server ? "afk.status.world" : "afk.status.server")} value={where} />
        <Stat icon={<Heart size={14} />} tone="text-danger" label={at("afk.status.health")} value={st.health !== undefined ? `${Math.round(st.health)} / ${st.max_health ?? 20}` : "–"} />
        <Stat icon={<Utensils size={14} />} tone="text-warn" label={at("afk.status.food")} value={st.food !== undefined ? `${st.food} / 20` : "–"} />
        <Stat icon={<Timer size={14} />} label={at("afk.status.uptime")} value={run.started_at ? formatUptime((run.ended_at ?? now) - run.started_at) : "–"} />
        <Stat icon={<Cpu size={14} />} label={at("afk.status.cpu")} value={res?.cpu_percent != null ? `${Math.round(res.cpu_percent)} %` : "–"} />
        <Stat icon={<MemoryStick size={14} />} label={at("afk.status.ram")} value={res?.memory_bytes != null ? `${(res.memory_bytes / 1024 ** 3).toFixed(1)} GB` : "–"} />
        <Stat icon={<Monitor size={14} />} label={at("afk.status.window")} value={at(session.window_hidden ? "afk.status.hidden" : "afk.status.shown")} />
      </div>

      {(session.overlay || (bg && session.agent !== "active" && session.agent !== "pending")) && (
        <div className="flex items-start gap-2 rounded-ctl bg-surface px-3 py-2 text-[12px] text-muted">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
          <span>{session.overlay ? at("afk.overlay_note") : at("afk.no_helper_note")}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] gap-2 max-[700px]:grid-cols-1">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-card bg-surface">
          <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px] font-semibold text-muted">
            {at("afk.chat")}
            {fromLog && <span className="font-normal text-dim">· {at("afk.chat.from_log")}</span>}
          </header>
          <div ref={chatRef} className="min-h-[80px] flex-1 overflow-y-auto py-1" data-testid="afk-chat">
            {chat.length === 0 ? <div className="px-3 py-2 text-[12.5px] text-dim">{at("afk.chat.empty")}</div> : chat.map((e, i) => <ChatLine key={`${e.ts}-${i}`} e={e} />)}
          </div>
          <Composer session={session} />
        </section>
        <section className="flex min-h-0 flex-col overflow-hidden rounded-card bg-surface">
          <header className="flex h-8 shrink-0 items-center border-b border-line px-3 text-[12px] font-semibold text-muted">{at("afk.events")}</header>
          <div className="min-h-[80px] flex-1 overflow-y-auto" data-testid="afk-events">
            {notable.length === 0 ? <div className="px-3 py-2 text-[12.5px] text-dim">{at("afk.events.empty")}</div> : notable.map((e, i) => <EventLine key={`${e.ts}-${i}`} e={e} />)}
          </div>
          <div className="shrink-0 border-t border-line px-3 py-1.5 text-[11px] leading-snug text-dim">{at("afk.heuristic")}</div>
        </section>
      </div>

      <div className="flex items-start gap-2 px-1 text-[11.5px] text-dim">
        <ShieldAlert size={12} className="mt-0.5 shrink-0" />
        <span>{at("afk.rules")}</span>
      </div>
    </div>
  );
}
