import { useEffect } from "react";
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { afkApi } from "./api";
import type { AfkEvent, AfkSession } from "./types";

const MAX = 500;

interface AfkStore {
  sessions: Record<string, AfkSession>;
  events: Record<string, AfkEvent[]>;
  loaded: Record<string, boolean>;
  setSession: (s: AfkSession) => void;
  addEvent: (runId: string, e: AfkEvent) => void;
  hydrate: (runId: string, list: AfkEvent[]) => void;
}

export const useAfkStore = create<AfkStore>((set) => ({
  sessions: {},
  events: {},
  loaded: {},
  setSession: (s) => set((st) => ({ sessions: { ...st.sessions, [s.run_id]: s } })),
  addEvent: (runId, e) =>
    set((st) => {
      const cur = st.events[runId] ?? [];
      const next = cur.length >= MAX ? [...cur.slice(cur.length - MAX + 1), e] : [...cur, e];
      return { events: { ...st.events, [runId]: next } };
    }),
  hydrate: (runId, list) => set((st) => ({ events: { ...st.events, [runId]: list.slice(-MAX) }, loaded: { ...st.loaded, [runId]: true } })),
}));

let started = false;

export function startAfkBridge() {
  if (started) return;
  started = true;
  afkApi
    .sessions()
    .then((l) => l.forEach((s) => useAfkStore.getState().setSession(s)))
    .catch(() => {});
  listen<AfkSession>("afk://session", (e) => useAfkStore.getState().setSession(e.payload)).catch(() => {});
  listen<{ run_id: string; event: AfkEvent }>("afk://event", (e) => {
    if (useAfkStore.getState().loaded[e.payload.run_id]) useAfkStore.getState().addEvent(e.payload.run_id, e.payload.event);
  }).catch(() => {});
}

export function useAfkSession(runId: string | null | undefined): AfkSession | undefined {
  useEffect(startAfkBridge, []);
  return useAfkStore((s) => (runId ? s.sessions[runId] : undefined));
}

export function useAfkSessions(): Record<string, AfkSession> {
  useEffect(startAfkBridge, []);
  return useAfkStore((s) => s.sessions);
}

const EMPTY: AfkEvent[] = [];

export function useAfkEvents(runId: string | null | undefined, tracked: boolean): AfkEvent[] {
  useEffect(startAfkBridge, []);
  useEffect(() => {
    if (!runId || !tracked) return;
    let dead = false;
    afkApi
      .events(runId)
      .then((l) => !dead && useAfkStore.getState().hydrate(runId, l))
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [runId, tracked]);
  return useAfkStore((s) => (runId ? s.events[runId] : undefined) ?? EMPTY);
}

export function isBackground(s: AfkSession | undefined) {
  return !!s && !s.ended && s.mode === "background";
}
