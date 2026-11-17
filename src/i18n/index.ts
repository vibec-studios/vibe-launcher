// Mini-i18n: flache Schlüssel, Deutsch + Englisch. Jeder Bereich hat eine eigene Datei
// (src/i18n/<bereich>.ts) mit `{ de: {...}, en: {...} }` – so gibt es keine Merge-Konflikte.
// Platzhalter: "Hallo {name}" + t("key", { name: "Steve" }).
import { create } from "zustand";
import common from "./common";
import instances from "./instances";
import discover from "./discover";
import accounts from "./accounts";
import settings from "./settings";
import logs from "./logs";
import external from "./external";
import skins from "./skins";
import stores from "./stores";
import platform from "./platform";
import servers from "./servers";

export type Lang = "de" | "en";
type Dict = Record<string, string>;
type Bundle = { de: Dict; en: Dict };

const bundles: Bundle[] = [common, instances, discover, accounts, settings, logs, external, skins, stores, platform, servers];
const dicts: Record<Lang, Dict> = { de: {}, en: {} };
for (const b of bundles) {
  Object.assign(dicts.de, b.de);
  Object.assign(dicts.en, b.en);
}

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLang = create<LangState>((set) => ({
  lang: (localStorageGet("lang") as Lang) || "de",
  setLang: (lang) => {
    localStorageSet("lang", lang);
    document.documentElement.lang = lang;
    set({ lang });
  },
}));

function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* egal */
  }
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? dicts.de[key] ?? dicts.en[key];
  if (s === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] fehlender Schlüssel: ${key}`);
    s = key;
  }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Übersetzungsfunktion für die aktuelle Sprache. */
export function useT() {
  const lang = useLang((s) => s.lang);
  return (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);
}

/** Außerhalb von React (Toasts etc.). */
export function t(key: string, vars?: Record<string, string | number>) {
  return translate(useLang.getState().lang, key, vars);
}
