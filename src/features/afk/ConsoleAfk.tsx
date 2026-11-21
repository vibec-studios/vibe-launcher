import { useEffect, useRef, useState } from "react";
import { MoonStar, SquareTerminal } from "lucide-react";
import { api } from "@/lib/api";
import type { GameState } from "@/lib/types";
import { at } from "./liteText";
import { isBackground, useAfkSession } from "./store";

export type ConsoleView = "log" | "afk";

export function useConsoleAfk(current: GameState | null) {
  const [enabled, setEnabled] = useState(false);
  const [view, setView] = useState<ConsoleView>("log");
  const session = useAfkSession(current?.run_id);
  const auto = useRef<string | null>(null);
  useEffect(() => {
    api
      .settingsGet()
      .then((s) => setEnabled(!!s.afk?.enabled))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!current) return;
    const key = `${current.run_id}:${session ? 1 : 0}`;
    if (auto.current === key) return;
    auto.current = key;
    setView(session && isBackground(session) ? "afk" : "log");
  }, [current?.run_id, session]);
  const available = enabled || !!session;
  return { available, view: available ? view : "log", setView, session, background: isBackground(session) };
}

export function ViewSwitch({ view, onChange, background }: { view: ConsoleView; onChange: (v: ConsoleView) => void; background: boolean }) {
  const btn = (v: ConsoleView, icon: React.ReactNode, label: string) => (
    <button
      aria-pressed={view === v}
      data-testid={`console-view-${v}`}
      onClick={() => onChange(v)}
      className={`flex h-7 items-center gap-1.5 rounded-ctl px-2.5 text-[12px] font-medium transition-colors ${view === v ? "bg-surface3 text-text" : "text-muted hover:text-text"}`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-ctl bg-surface2 p-0.5">
      {btn("log", <SquareTerminal size={13} />, at("afk.tab.log"))}
      {btn("afk", <MoonStar size={13} className={background ? "text-brand" : undefined} />, at("afk.tab.afk"))}
    </div>
  );
}
