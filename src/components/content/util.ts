// Hilfsfunktionen für Inhalte (Entdecken, Projektseite, Inhalte-Tab, Import). OWNER: Frontend-Agent B.
import { router } from "@/app/router";
import type { ContentKind, Instance, LoaderKind, ProjectHit, ProjectType, Source } from "@/lib/types";

/** Navigation außerhalb des Router-Kontexts (globale Dialoge). */
export function navigateTo(opts: { to: string; params?: Record<string, string>; search?: Record<string, unknown> }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void router.navigate(opts as any);
}

/** Aktueller Pfad der App (z. B. "/instances/abc"). */
export function currentPath(): string {
  return router.state.location.pathname;
}

export function contentKindOf(t: ProjectType): ContentKind | null {
  return t === "mod" ? "mod" : t === "resourcepack" ? "resourcepack" : t === "shader" ? "shader" : null;
}

/** Unterordner im Spielordner je Inhaltsart. */
export const kindFolder: Record<ContentKind, string> = { mod: "mods", resourcepack: "resourcepacks", shader: "shaderpacks" };

/** Dateiendungen, die je Inhaltsart hinzugefügt werden können. */
export const kindExtensions: Record<ContentKind, string[]> = { mod: ["jar"], resourcepack: ["zip"], shader: ["zip"] };

export const sourceNames: Record<Source, string> = { modrinth: "Modrinth", curseforge: "CurseForge" };

/** Öffentliche Projektseite im Browser. */
export function projectWebUrl(p: Pick<ProjectHit, "source" | "slug" | "id" | "project_type">): string {
  if (p.source === "modrinth") {
    const seg = p.project_type === "shader" ? "shader" : p.project_type;
    return `https://modrinth.com/${seg}/${p.slug || p.id}`;
  }
  const seg =
    p.project_type === "mod"
      ? "mc-mods"
      : p.project_type === "modpack"
        ? "modpacks"
        : p.project_type === "resourcepack"
          ? "texture-packs"
          : p.project_type === "shader"
            ? "shaders"
            : "data-packs";
  return `https://www.curseforge.com/minecraft/${seg}/${p.slug || p.id}`;
}

/** Loader-Filter für Versionsabfragen (nur bei Mods/Modpacks sinnvoll). */
export function loaderFilterFor(type: ProjectType, inst: Pick<Instance, "loader"> | null | undefined): LoaderKind | null {
  if (!inst || (type !== "mod" && type !== "modpack")) return null;
  return inst.loader.kind === "vanilla" ? null : inst.loader.kind;
}

export function loaderMatches(inst: LoaderKind, loaders: string[]): boolean {
  if (!loaders.length) return true;
  const l = loaders.map((x) => x.toLowerCase());
  if (l.includes(inst)) return true;
  // Quilt lädt Fabric-Mods
  if (inst === "quilt" && l.includes("fabric")) return true;
  return false;
}

export type Compat = { ok: true } | { ok: false; reason: "loader" | "version" | "vanilla" };

/** Passt ein Projekt zu einer Instanz? Unbekannte Angaben gelten als kompatibel. */
export function compatibility(p: Pick<ProjectHit, "project_type" | "loaders" | "game_versions">, inst: Instance): Compat {
  if (p.project_type === "mod") {
    if (inst.loader.kind === "vanilla") return { ok: false, reason: "vanilla" };
    if (!loaderMatches(inst.loader.kind, p.loaders)) return { ok: false, reason: "loader" };
  }
  if (p.game_versions.length && !p.game_versions.includes(inst.mc_version)) return { ok: false, reason: "version" };
  return { ok: true };
}

/** Text in die Zwischenablage (Tauri-Plugin, Fallback Browser-API). */
export async function copyText(text: string): Promise<void> {
  try {
    const m = await import("@tauri-apps/plugin-clipboard-manager");
    await m.writeText(text);
  } catch {
    await navigator.clipboard?.writeText(text);
  }
}

/** Externe URL im Systembrowser öffnen. */
export async function openExternal(url: string): Promise<void> {
  try {
    const m = await import("@tauri-apps/plugin-opener");
    await m.openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

export function fileExt(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

/** Stabiler Schlüssel eines Inhalts unabhängig vom Aktiv-Zustand (".disabled"-Endung). */
export function contentKey(fileName: string): string {
  return fileName.replace(/\.disabled$/i, "");
}

/** Sortierte, eindeutige MC-Versionen ("1.21.10" > "1.21.9"). */
export function compareMc(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** "1.20.1 – 1.21.4" bzw. einzelne Version. */
export function versionRange(versions: string[]): string | null {
  const rel = versions.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v)).sort(compareMc);
  if (!rel.length) return versions[0] ?? null;
  return rel.length === 1 ? rel[0] : `${rel[0]} – ${rel[rel.length - 1]}`;
}
