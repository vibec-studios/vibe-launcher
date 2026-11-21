// Mini-i18n: flache Schlüssel, Deutsch + Englisch. Jeder Bereich hat eine eigene Datei
// (src/i18n/<bereich>.ts) mit `{ de: {...}, en: {...} }` – so gibt es keine Merge-Konflikte.
// Platzhalter: "Hallo {name}" + t("key", { name: "Steve" }).
import { create } from "zustand";
import { isLang, normalizeLang, type Lang } from "./languages";

export { LANGUAGES, intlLocale, isLang, languageName, normalizeLang, type Lang } from "./languages";
type Dict = Record<string, string>;
type Bundle = { de: Dict; en: Dict };

const modules = import.meta.glob<Bundle>(["./*.ts", "!./index.ts", "!./languages.ts"], { eager: true, import: "default" });
const bundles: Bundle[] = Object.keys(modules)
  .sort()
  .map((k) => modules[k]);
const dicts: Partial<Record<Lang, Dict>> & { de: Dict; en: Dict } = { de: {}, en: {} };
for (const b of bundles) {
  Object.assign(dicts.de, b.de);
  Object.assign(dicts.en, b.en);
}

const locales = import.meta.glob<{ default: Dict; extras?: Record<string, unknown> }>("./locales/*/index.ts");
const loading = new Map<Lang, Promise<void>>();
const extras: Partial<Record<Lang, Record<string, unknown>>> = {};

export function localeExtra<T>(lang: Lang, name: string): T | undefined {
  return extras[lang]?.[name] as T | undefined;
}

export function loadLang(lang: Lang): Promise<void> {
  if (dicts[lang]) return Promise.resolve();
  const loader = locales[`./locales/${lang}/index.ts`];
  if (!loader) return Promise.resolve();
  let p = loading.get(lang);
  if (!p) {
    p = loader()
      .then((m) => {
        dicts[lang] = m.default;
        extras[lang] = m.extras ?? {};
        useLang.setState((s) => ({ rev: s.rev + 1 }));
      })
      .catch((e) => {
        loading.delete(lang);
        console.warn(`[i18n] Sprache ${lang} nicht ladbar`, e);
      });
    loading.set(lang, p);
  }
  return p;
}

interface LangState {
  lang: Lang;
  /** Simple-Modus: Schlüssel mit `simple:`-Variante (src/i18n/simple.ts) nutzen einfache Wörter ohne Fachbegriffe.
   *  Gesetzt von `ModeHost` (src/lib/mode.tsx). */
  simple: boolean;
  rev: number;
  setLang: (l: Lang) => void;
}

export const useLang = create<LangState>((set) => ({
  lang: normalizeLang(localStorageGet("lang")) ?? "de",
  simple: localStorageGet("vl.mode") === "simple",
  rev: 0,
  setLang: (raw) => {
    const lang = isLang(raw) ? raw : (normalizeLang(raw) ?? "en");
    localStorageSet("lang", lang);
    document.documentElement.lang = lang;
    set({ lang });
    void loadLang(lang);
  },
}));

export const i18nReady: Promise<void> = loadLang(useLang.getState().lang);

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

function lookup(lang: Lang, key: string, simple: boolean): string | undefined {
  const sk = `simple:${key}`;
  if (lang === "de" || lang === "en") {
    return (simple ? (dicts[lang][sk] ?? dicts.de[sk]) : undefined) ?? dicts[lang][key] ?? dicts.de[key] ?? dicts.en[key];
  }
  const d = dicts[lang];
  return (simple ? d?.[sk] : undefined) ?? d?.[key] ?? (simple ? dicts.en[sk] : undefined) ?? dicts.en[key] ?? dicts.de[key];
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>, simple = false): string {
  let s = lookup(lang, key, simple);
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
  useLang((s) => s.rev);
  return (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars, simple);
}

/** Außerhalb von React (Toasts etc.). */
export function t(key: string, vars?: Record<string, string | number>) {
  const s = useLang.getState();
  return translate(s.lang, key, vars, s.simple);
}
