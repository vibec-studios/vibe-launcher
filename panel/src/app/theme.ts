import { useSyncExternalStore } from "react";

export type Tone = "dark" | "light";
const KEY = "vibe-panel.tone";
const listeners = new Set<() => void>();

function read(): Tone {
  return document.documentElement.dataset.tone === "light" ? "light" : "dark";
}

export function setTone(t: Tone) {
  document.documentElement.dataset.tone = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* privat */
  }
  listeners.forEach((l) => l());
}

export function useTone(): Tone {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, read);
}
