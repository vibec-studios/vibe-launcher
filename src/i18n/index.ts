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
import contenttools from "./contenttools";
import backups from "./backups";
import files from "./files";
import social from "./social";
import instancepage from "./instancepage";
import cosmetics from "./cosmetics";
import minecraftcapes from "./minecraftcapes";
import appearance from "./appearance";
import home from "./home";
import manual from "./manual";
import clientpacks from "./clientpacks";
import simple from "./simple";
import play from "./play";
import notices from "./notices";
import modsets from "./modsets";
import bedrock from "./bedrock";
import feedback from "./feedback";
import clips from "./clips";
import updates from "./updates";
import datapacks from "./datapacks";
import serverhints from "./serverhints";
import perf from "./perf";
import storage from "./storage";
import prelaunch from "./prelaunch";
import bedrockfix from "./bedrockfix";
import playwarn from "./playwarn";
import designv2 from "./designv2";
import help from "./help";
import access from "./access";
import iconart from "./iconart";
import customize from "./customize";
import sessions from "./sessions";
import usability from "./usability";
import organize from "./organize";

export type Lang = "de" | "en";
type Dict = Record<string, string>;
type Bundle = { de: Dict; en: Dict };

const bundles: Bundle[] = [common, instances, discover, accounts, settings, logs, external, skins, stores, platform, servers, contenttools, backups, files, social, instancepage, cosmetics, minecraftcapes, appearance, home, manual, clientpacks, simple, play, notices, modsets, bedrock, feedback, clips, updates, datapacks, serverhints, perf, storage, prelaunch, bedrockfix, playwarn, designv2, help, access, iconart, customize, sessions, usability, organize];
const dicts: Record<Lang, Dict> = { de: {}, en: {} };
for (const b of bundles) {
  Object.assign(dicts.de, b.de);
  Object.assign(dicts.en, b.en);
}

interface LangState {
  lang: Lang;
  /** Simple-Modus: Schlüssel mit `simple:`-Variante (src/i18n/simple.ts) nutzen einfache Wörter ohne Fachbegriffe.
   *  Gesetzt von `ModeHost` (src/lib/mode.tsx). */
  simple: boolean;
  setLang: (l: Lang) => void;
}

export const useLang = create<LangState>((set) => ({
  lang: (localStorageGet("lang") as Lang) || "de",
  simple: localStorageGet("vl.mode") === "simple",
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

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>, simple = false): string {
  let s = (simple ? (dicts[lang][`simple:${key}`] ?? dicts.de[`simple:${key}`]) : undefined) ?? dicts[lang][key] ?? dicts.de[key] ?? dicts.en[key];
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
  const simple = useLang((s) => s.simple);
  return (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars, simple);
}

/** Außerhalb von React (Toasts etc.). */
export function t(key: string, vars?: Record<string, string | number>) {
  const s = useLang.getState();
  return translate(s.lang, key, vars, s.simple);
}
