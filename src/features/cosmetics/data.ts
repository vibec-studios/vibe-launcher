// Datenschicht der Cosmetics: Katalog/Besitz/Loadout/Einreichungen (TanStack Query), `.vibey`-Bundles (Rust-Cache
// per SHA-256), Vorschaubilder und Live-Updates (Gateway `catalog.updated`, `submission.updated`, `loadout.updated`).
// Ohne Gateway (Freunde/Presence aus) wird der Katalog alle 5 Minuten und beim Fokussieren neu geladen.
import { useQuery } from "@tanstack/react-query";
import { queryClient, useSettings } from "@/lib/queries";
import { useSocial, vibeClient } from "@/features/social/service";
import { t } from "@/i18n";
import type { Bundle, VibeyJson } from "./vibey3d";
import { capi, vapi } from "./api";
import type { Catalog, CatalogItem, Category, CosmeticsMe, Submission } from "./types";

export const cqk = {
  catalog: ["vibe", "cosmetics", "catalog"] as const,
  me: ["vibe", "cosmetics", "me"] as const,
  submissions: ["vibe", "cosmetics", "submissions"] as const,
  thumb: (url: string) => ["vibe", "cosmetics", "thumb", url] as const,
  status: (id: string) => ["vibey", "status", id] as const,
  latest: ["vibey", "latest"] as const,
  blockbench: ["vibey", "blockbench"] as const,
  instances: ["vibey", "instances"] as const,
};

export type Access = "loading" | "off" | "no_account" | "logged_out" | "ready";

/** Darf/kann die Cosmetics-Seite mit dem Backend reden? */
export function useAccess(): Access {
  const settings = useSettings();
  const conn = useSocial((s) => s.conn);
  useSocial((s) => s.identity); // neu rendern, sobald der Client angelegt ist
  if (!settings.data) return "loading";
  if (!settings.data.vibe?.enabled) return "off";
  if (conn === "no_account") return "no_account";
  if (conn === "logged_out" || conn === "logging_in") return "logged_out";
  if (!vibeClient()) return "loading";
  return "ready";
}

export function useCatalog(enabled: boolean) {
  const live = useSocial((s) => s.conn === "ready");
  return useQuery({
    queryKey: cqk.catalog,
    queryFn: capi.catalog,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // Ohne Gateway kein catalog.updated -> regelmäßig nachsehen
    refetchInterval: live ? false : 5 * 60_000,
  });
}

export function useMe(enabled: boolean) {
  return useQuery({ queryKey: cqk.me, queryFn: capi.me, enabled, staleTime: 30_000 });
}

export function useSubmissions(enabled: boolean) {
  const live = useSocial((s) => s.conn === "ready");
  return useQuery({ queryKey: cqk.submissions, queryFn: capi.submissions, enabled, staleTime: 15_000, refetchInterval: live ? false : 60_000 });
}

// ------------------------------------------------------------------ Bundles

const bundles = new Map<string, Promise<Bundle>>();

/** `.vibey`-JSON vorbereiten (Texturen dekodieren). Lädt three.js erst bei Bedarf. */
export async function parseBundle(json: unknown): Promise<Bundle> {
  const { prepareBundle } = await import("./vibey3d");
  return prepareBundle(json as VibeyJson);
}

/** Bundle eines Katalog-Items (Rust-Cache per SHA-256, sonst Download + Prüfung). */
export function loadBundle(hash: string): Promise<Bundle> {
  let p = bundles.get(hash);
  if (!p) {
    p = vapi
      .asset(hash)
      .then((text) => parseBundle(JSON.parse(text)))
      .catch((e) => {
        bundles.delete(hash);
        throw e;
      });
    bundles.set(hash, p);
  }
  return p;
}

let prefetching = "";
/** Fehlende Assets im Hintergrund nachladen (OTA: neue Items brauchen kein Update). */
export async function prefetchAssets(cat: Catalog) {
  if (prefetching === cat.version) return;
  prefetching = cat.version;
  const queue = cat.items.map((i) => i.asset.hash);
  const worker = async () => {
    for (let h = queue.shift(); h; h = queue.shift()) await vapi.asset(h).catch(() => {});
  };
  await Promise.all([worker(), worker(), worker()]);
}

// ------------------------------------------------------------------ Vorschaubilder

const generated = new Map<string, Promise<string>>();

/** Vorschaubild: vom Server (gecacht in Rust), sonst aus dem 3D-Modell erzeugt. */
export function useThumbnail(item: Pick<CatalogItem, "thumbnailUrl" | "asset">, visible: boolean) {
  return useQuery({
    queryKey: ["vibe", "cosmetics", "thumb", item.thumbnailUrl ?? `gen:${item.asset.hash}`],
    enabled: visible,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      if (item.thumbnailUrl) {
        const url = await vapi.thumbnail(item.thumbnailUrl).catch(() => null);
        if (url) return url;
      }
      return generateThumb(item.asset.hash);
    },
  });
}

export function generateThumb(hash: string): Promise<string> {
  let p = generated.get(hash);
  if (!p) {
    p = loadBundle(hash).then(async (b) => (await import("./vibey3d")).renderThumbnail(b));
    p.catch(() => generated.delete(hash));
    generated.set(hash, p);
  }
  return p;
}

// ------------------------------------------------------------------ Helfer

export const categoryOf = (i: Pick<CatalogItem, "kind" | "slot">): Category => (i.kind === "emote" ? "emote" : (i.slot ?? "back"));

export function itemName(i: { name: { en: string; de?: string } }, lang: string) {
  return lang === "de" ? (i.name.de ?? i.name.en) : i.name.en;
}

export function itemDesc(i: { description?: { en?: string; de?: string } }, lang: string) {
  const d = i.description ?? {};
  return (lang === "de" ? (d.de ?? d.en) : (d.en ?? d.de)) ?? "";
}

export const RARITY_COLOR: Record<string, string> = { common: "#a1a1aa", rare: "#3fe0c5", epic: "#8b6cff", legendary: "#ffb547" };

// ------------------------------------------------------------------ Live-Updates (vom CosmeticsBridge aufgerufen)

export function onCatalogUpdated(d: unknown) {
  const v = (d as { version?: string } | null)?.version;
  const cur = queryClient.getQueryData<Catalog>(cqk.catalog);
  if (v && cur?.version === v) return;
  void queryClient.invalidateQueries({ queryKey: cqk.catalog });
  void queryClient.invalidateQueries({ queryKey: cqk.me });
}

export function onSubmissionUpdated(d: unknown, notify: (tone: "success" | "error" | "info", title: string, text?: string) => void) {
  const s = (d as { submission?: Submission } | null)?.submission;
  if (!s) return;
  const prev = queryClient.getQueryData<Submission[]>(cqk.submissions);
  const old = prev?.find((x) => x.id === s.id);
  queryClient.setQueryData<Submission[]>(cqk.submissions, (list) => (list ? (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [s, ...list]) : list));
  if (old?.status === s.status) return;
  if (s.status === "approved") {
    notify("success", t("cos.sub.toast.approved", { name: s.name }), t("cos.sub.toast.approved_text"));
    void queryClient.invalidateQueries({ queryKey: cqk.catalog });
    void queryClient.invalidateQueries({ queryKey: cqk.me });
  } else if (s.status === "rejected") notify("error", t("cos.sub.toast.rejected", { name: s.name }), s.reason ?? undefined);
}

export function onLoadoutUpdated(d: unknown) {
  const ev = d as { userId?: string; slots?: CosmeticsMe["loadout"]["slots"]; emoteWheel?: (string | null)[] } | null;
  const me = useSocial.getState().me;
  if (!ev?.slots || (me && ev.userId && ev.userId !== me.id)) return;
  queryClient.setQueryData<CosmeticsMe>(cqk.me, (cur) => (cur ? { ...cur, loadout: { slots: ev.slots!, emoteWheel: ev.emoteWheel ?? cur.loadout.emoteWheel } } : cur));
}
