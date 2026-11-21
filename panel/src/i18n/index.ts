import { useSyncExternalStore } from "react";
import { de, type Key } from "./de";
import { en } from "./en";

export type Lang = "de" | "en";
export type { Key };

const KEY = "vibe-panel.lang";
const dicts: Record<Lang, Record<Key, string>> = { de, en };
const listeners = new Set<() => void>();

function initial(): Lang {
  try {
    const s = localStorage.getItem(KEY);
    if (s === "de" || s === "en") return s;
  } catch {
    /* privat */
  }
  return navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

let lang: Lang = initial();
document.documentElement.lang = lang;

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* privat */
  }
  listeners.forEach((cb) => cb());
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? de[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function useLang(): Lang {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getLang);
}

export function useT() {
  useLang();
  return t;
}
