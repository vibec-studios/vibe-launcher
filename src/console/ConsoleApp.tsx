import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, Copy, FolderOpen, Search, Square, SquareTerminal, WrapText } from "lucide-react";
import { api } from "@/lib/api";
import { useGameStore } from "@/lib/gameStore";
import { formatUptime, isActive } from "@/lib/sessions";
import { CATS, catOf, formatLines, type LevelCat } from "@/features/logs/levels";
import type { GameState, Instance, LogLine } from "@/lib/types";
import { ct } from "./i18n";
import { LogView } from "./LogView";
import { useConsoleData } from "./useConsoleData";
import { AfkPanel } from "@/features/afk/AfkPanel";
import { useConsoleAfk, ViewSwitch } from "@/features/afk/ConsoleAfk";

const EMPTY: LogLine[] = [];
const DOT: Record<LevelCat, string> = { info: "bg-text", warn: "bg-warn", error: "bg-danger", debug: "bg-dim", launcher: "bg-brand" };

function stateLabel(r: GameState) {
  if (r.state === "stopped") return ct(r.crashed ? "console.state.crashed" : "console.state.stopped");
  return ct(`console.state.${r.state}`);
}

function StatusDot({ r }: { r: GameState }) {
  const c = r.state === "running" ? "bg-ok" : r.state === "preparing" ? "bg-warn animate-pulse" : r.crashed ? "bg-danger" : "bg-dim";
  return <span className={`h-2 w-2 shrink-0 rounded-dot ${c}`} />;
}

function Tab({ r, inst, on, onClick }: { r: GameState; inst?: Instance; on: boolean; onClick: () => void }) {
  return (
    <button
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-8 shrink-0 items-center gap-2 rounded-ctl px-3 text-[12.5px] font-medium transition-colors ${on ? "bg-surface3 text-text" : "text-muted hover:bg-white/[.05] hover:text-text"}`}
    >
      <StatusDot r={r} />
      <span className="max-w-[180px] truncate">{inst?.name ?? r.instance_id}</span>
      {r.slot > 1 && <span className="text-dim">#{r.slot}</span>}
      {r.account_name && <span className="max-w-[110px] truncate text-[11px] text-dim">{r.account_name}</span>}
    </button>
  );
}

function Btn({ label, onClick, children, active, danger, disabled }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[12.5px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
        danger ? "bg-danger/12 text-danger hover:bg-danger hover:text-black" : active ? "bg-surface3 text-text" : "text-muted hover:bg-white/[.06] hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

async function copy(text: string) {
  try {
    const m = await import("@tauri-apps/plugin-clipboard-manager");
    await m.writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function ConsoleApp() {
  const { instances, runs, current, select } = useConsoleData();
  const lines = useGameStore((s) => (current ? s.logs[current.run_id] : undefined) ?? EMPTY);
  const [query, setQuery] = useState("");
  const [cats, setCats] = useState<LevelCat[]>(CATS);
  const [wrap, setWrap] = useState(false);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const dq = useDeferredValue(query.trim().toLowerCase());
  const now = useNow();
  const afk = useConsoleAfk(current);

  const { shown, counts } = useMemo(() => {
    const counts: Record<LevelCat, number> = { info: 0, warn: 0, error: 0, debug: 0, launcher: 0 };
    const all = cats.length === CATS.length && !dq;
    const shown: LogLine[] = all ? lines : [];
    for (const l of lines) {
      const c = catOf(l.level);
      counts[c]++;
      if (!all && cats.includes(c) && (!dq || l.text.toLowerCase().includes(dq) || (l.logger ?? "").toLowerCase().includes(dq))) shown.push(l);
    }
    return { shown, counts };
  }, [lines, cats, dq]);

  useEffect(() => {
    const inst = current ? instances[current.instance_id] : undefined;
    document.title = inst ? `${inst.name}${current && current.slot > 1 ? ` #${current.slot}` : ""} – ${ct("console.title")}` : `Vibe Launcher – ${ct("console.title")}`;
  }, [current, instances]);

  const toggle = (c: LevelCat) => setCats((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const doCopy = () => {
    copy(formatLines(shown)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2">
        <SquareTerminal size={16} className="mx-1.5 shrink-0 text-brand" />
        {runs.length === 0 && <span className="text-[12.5px] text-dim">{ct("console.empty")}</span>}
        {runs.map((r) => (
          <Tab key={r.run_id} r={r} inst={instances[r.instance_id]} on={r.run_id === current?.run_id} onClick={() => select(r.run_id)} />
        ))}
        {afk.available && current && <ViewSwitch view={afk.view} onChange={afk.setView} background={afk.background} />}
      </div>

      {afk.view === "afk" && current ? (
        <AfkPanel run={current} session={afk.session} />
      ) : (
      <>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
        <label className="flex h-8 min-w-[100px] max-w-[230px] flex-[1_1_100px] items-center gap-2 rounded-ctl bg-surface2 px-2.5 text-muted focus-within:text-text">
          <Search size={14} className="shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ct("console.search")}
            className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-dim"
          />
        </label>
        <div className="flex flex-wrap items-center gap-0.5">
          {CATS.map((c) => (
            <button
              key={c}
              aria-pressed={cats.includes(c)}
              onClick={() => toggle(c)}
              className={`flex h-8 items-center gap-1.5 rounded-ctl px-2 text-[12px] transition-colors ${cats.includes(c) ? "text-text hover:bg-white/[.05]" : "text-dim line-through opacity-60 hover:opacity-100"}`}
            >
              <span className={`h-1.5 w-1.5 rounded-dot ${DOT[c]}`} />
              {ct(`console.lvl.${c}`)}
              <span className="tabular-nums text-dim">{counts[c].toLocaleString()}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Btn label={ct("console.follow")} active={follow} onClick={() => setFollow(!follow)}>
            <ArrowDownToLine size={14} />
          </Btn>
          <Btn label={ct("console.wrap")} active={wrap} onClick={() => setWrap(!wrap)}>
            <WrapText size={14} />
          </Btn>
          <Btn label={ct("console.copy")} disabled={!shown.length} onClick={doCopy}>
            <Copy size={14} />
            {copied ? ct("console.copied") : ct("console.copy")}
          </Btn>
          <Btn label={ct("console.folder")} disabled={!current} onClick={() => current && api.instanceOpenFolder(current.instance_id, "logs").catch(() => {})}>
            <FolderOpen size={14} />
            {ct("console.folder")}
          </Btn>
          <Btn label={ct("console.stop")} danger disabled={!isActive(current ?? undefined)} onClick={() => current && api.instanceKill(current.instance_id, current.run_id).catch(() => {})}>
            <Square size={11} fill="currentColor" />
            {ct("console.stop")}
          </Btn>
        </div>
      </div>

      {current ? (
        <LogView lines={shown} q={dq} wrap={wrap} follow={follow} onFollow={setFollow} />
      ) : (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <SquareTerminal size={30} className="mx-auto mb-3 text-dim" />
            <div className="text-[14px] font-semibold">{ct("console.empty")}</div>
            <div className="mt-1 text-[12.5px] text-muted">{ct("console.empty_text")}</div>
          </div>
        </div>
      )}
      </>
      )}

      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line px-3 text-[11.5px] text-dim">
        {current && (
          <>
            <span className="flex items-center gap-1.5 text-muted">
              <StatusDot r={current} />
              {stateLabel(current)}
            </span>
            {current.account_name && <span>{current.account_name}</span>}
            {current.pid && <span>PID {current.pid}</span>}
            {current.started_at && <span className="tabular-nums">{formatUptime((current.ended_at ?? now) - current.started_at)}</span>}
            {current.world && <span className="truncate">{current.world}</span>}
          </>
        )}
        <span className="ml-auto tabular-nums">{ct("console.lines", { n: shown.length.toLocaleString() })}</span>
      </div>
    </div>
  );
}
