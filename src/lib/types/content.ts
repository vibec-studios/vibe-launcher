import type { Side } from "./contentTools";
import type { Loader, LoaderKind } from "./instances";

// ------------------------------------------------------------------ Inhalte

/** Eigene Stores (docs/STORE.md) erscheinen als "store:<id>". */
export type Source = "modrinth" | "curseforge" | `store:${string}`;
export type ProjectType = "mod" | "modpack" | "resourcepack" | "shader" | "datapack";
/** datapack = `datapacks/` im Spielordner (global; Vanilla lädt den Ordner nicht automatisch, siehe CONTRACT.md) */
export type ContentKind = "mod" | "resourcepack" | "shader" | "datapack";
export type SortOrder = "relevance" | "downloads" | "follows" | "newest" | "updated";

export interface SearchQuery {
  source: Source;
  query: string;
  project_type: ProjectType;
  game_version: string | null;
  loader: LoaderKind | null;
  categories: string[];
  sort: SortOrder;
  offset: number;
  limit: number;
  /** Nur Projekte, die nach diesem Zeitpunkt angelegt wurden (Unix-Sekunden, Modrinth) */
  created_after?: number | null;
}

export interface ProjectHit {
  source: Source;
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  project_type: ProjectType;
  updated: string | null;
  game_versions: string[];
  loaders: string[];
  /** Vorschaubild (hervorgehobenes Galerie-Bild) */
  banner_url?: string | null;
  /** Markenfarbe (RGB als Zahl, Modrinth) */
  color?: number | null;
  /** ISO-8601, angelegt */
  created?: string | null;
  /** CurseForge: Autor erlaubt keine Downloads über andere Launcher -> Datei auf curseforge.com laden */
  manual_download?: boolean;
}

export interface SearchResult {
  hits: ProjectHit[];
  total: number;
  offset: number;
  limit: number;
}

export interface GalleryImage {
  url: string;
  title: string | null;
  description: string | null;
  featured: boolean;
}

export interface ProjectLinks {
  website: string | null;
  source: string | null;
  issues: string | null;
  wiki: string | null;
  discord: string | null;
}

export interface ProjectDetails extends ProjectHit {
  body: string;
  body_format: "markdown" | "html";
  gallery: GalleryImage[];
  links: ProjectLinks;
  license: string | null;
  published: string | null;
  page_url: string;
}

export interface VersionFile {
  url: string | null;
  filename: string;
  size: number;
  sha1: string | null;
  primary: boolean;
  /** nur Modrinth */
  sha512?: string | null;
  /** CurseForge-Fingerprint */
  fingerprint?: number | null;
}

export type DependencyKind = "required" | "optional" | "incompatible" | "embedded";

export interface Dependency {
  project_id: string | null;
  version_id: string | null;
  kind: DependencyKind;
  /** Abweichende Quelle (z. B. Store-Projekt braucht Modrinth-Mod) */
  source?: Source | null;
}

export interface ProjectVersion {
  source: Source;
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  release_type: "release" | "beta" | "alpha";
  date: string;
  downloads: number;
  files: VersionFile[];
  dependencies: Dependency[];
  changelog: string | null;
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
}

export interface ContentItem {
  file_name: string;
  kind: ContentKind;
  enabled: boolean;
  name: string;
  version: string | null;
  description: string | null;
  authors: string[];
  icon: string | null;
  source: Source | null;
  project_id: string | null;
  version_id: string | null;
  size: number;
  modified: number;
  /** Version fixiert (kein Auto-Update, nicht bei „Alle aktualisieren“) */
  pinned: boolean;
  /** Client/Server-Einordnung */
  side: Side;
}

export interface ContentUpdate {
  file_name: string;
  kind: ContentKind;
  source: Source;
  project_id: string;
  current_version: string | null;
  new_version: ProjectVersion;
  /** Gesperrter CurseForge-Download: nur manuell über `page_url`, „Alle aktualisieren“ überspringt es */
  manual?: boolean;
  /** Dateiseite der neuen Version (bei `manual`) */
  page_url?: string | null;
}

export interface World {
  folder: string;
  name: string;
  last_played: number | null;
  game_mode: string | null;
  icon: string | null;
  size: number | null;
}

export type PackFormat = "mrpack" | "curseforge" | "vlpack" | "prism" | "multimc";

export interface ImportPreview {
  format: PackFormat;
  name: string;
  version_name: string | null;
  mc_version: string;
  loader: Loader;
  file_count: number;
  icon: string | null;
  author: string | null;
  /** Herunterzuladende Dateien mit Client/Server-Einordnung */
  files: ImportFile[];
}

export interface ImportFile {
  path: string;
  side: Side;
}

export interface ExportOptions {
  format: PackFormat;
  dest: string;
  name: string;
  version: string;
  author: string | null;
  description: string | null;
  include: string[];
}

export interface ExportEntry {
  path: string;
  is_dir: boolean;
  size: number;
  default_selected: boolean;
}

export interface MissingDownload {
  file_name: string;
  project_name: string;
  page_url: string;
  kind: ContentKind;
  version_number?: string | null;
  /** Ersetzt beim Eintreffen eine ältere Version (manuelles Update) */
  is_update?: boolean;
}

/** Ziel für „Auf CurseForge herunterladen“ */
export interface ManualTarget {
  page_url: string;
  file_name: string;
  version_id: string;
  version_number: string;
  /** Doch automatisch installierbar (freigegeben oder identisch auf Modrinth) */
  downloadable: boolean;
}

/** Event `content://manual-arrived` */
export interface ManualArrived {
  instance_id: string;
  project_id: string | null;
  project_name: string;
  file_name: string;
  kind: ContentKind;
}

export interface MissingScan {
  found: MissingDownload[];
  remaining: MissingDownload[];
  /** Durchsuchter Download-Ordner */
  folder: string | null;
  /** ms seit Epoch */
  watching_until: number | null;
}

export interface UpdateInfo {
  version: string;
  current_version: string;
  channel: "release" | "dev";
  notes: string | null;
  date: string | null;
}

export interface DatapackOverview {
  packs: { file_name: string; in_worlds: string[] }[];
  worlds: { folder: string; name: string }[];
}

export interface DataDirPreview {
  current: string;
  default: string;
  locked: boolean;
  target: string | null;
  size: number;
  free: number | null;
  enough: boolean;
  problem: string | null;
  busy: string[];
  bedrock_warning: boolean;
}

export interface UpdateBlockers {
  servers: number;
  games: number;
  tasks: string[];
  bedrock_swap: boolean;
}
