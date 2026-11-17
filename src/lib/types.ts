// Typen des Backend-Vertrags. Spiegeln die Rust-Structs (snake_case-Felder!). Siehe docs/CONTRACT.md.

export interface AppError {
  kind: "error" | "not_found" | "invalid" | "cancelled" | "not_configured" | "auth" | "network" | "io" | "json" | "zip";
  message: string;
}

// ------------------------------------------------------------------ Instanzen

export type LoaderKind = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

export interface Loader {
  kind: LoaderKind;
  version: string | null;
}

export interface JavaOptions {
  path: string | null;
  min_memory_mb: number | null;
  max_memory_mb: number | null;
  jvm_args: string | null;
  env: Record<string, string>;
}

export interface WindowOptions {
  width: number | null;
  height: number | null;
  fullscreen: boolean | null;
}

export type PackSourceKind = "modrinth" | "curseforge" | "vlpack" | "prism" | "local";

export interface PackSource {
  kind: PackSourceKind;
  project_id: string | null;
  version_id: string | null;
  name: string | null;
  version_name: string | null;
}

export type InstallState = "not_installed" | "installing" | "installed" | "failed";

export interface Instance {
  id: string;
  name: string;
  icon: string | null;
  accent: string | null;
  group: string | null;
  mc_version: string;
  loader: Loader;
  java: JavaOptions;
  window: WindowOptions;
  source: PackSource | null;
  install_state: InstallState;
  version_id: string | null;
  created_at: number;
  last_played: number | null;
  play_time_secs: number;
  notes: string | null;
}

export interface CreateInstance {
  name: string;
  mc_version: string;
  loader: Loader;
  icon?: string | null;
  accent?: string | null;
  group?: string | null;
}

/** Nur gesetzte Felder werden übernommen. `null` bei optionalen Feldern = zurücksetzen. */
export interface InstancePatch {
  name?: string;
  icon?: string | null;
  accent?: string | null;
  group?: string | null;
  mc_version?: string;
  loader?: Loader;
  java?: JavaOptions;
  window?: WindowOptions;
  notes?: string | null;
}

// ------------------------------------------------------------------ Einstellungen / System

export type LaunchBehavior = "keep" | "minimize" | "hide";

export interface Settings {
  language: "de" | "en";
  min_memory_mb: number;
  max_memory_mb: number;
  jvm_args: string;
  game_width: number;
  game_height: number;
  fullscreen: boolean;
  java_overrides: Record<string, string>;
  auto_java: boolean;
  launch_behavior: LaunchBehavior;
  show_snapshots: boolean;
  concurrent_downloads: number;
  curseforge_api_key: string | null;
  msa_client_id: string | null;
  check_updates: boolean;
  wrapper_command: string | null;
  open_log_on_launch: boolean;
  reduce_motion: boolean;
}

export interface SystemInfo {
  version: string;
  data_dir: string;
  os: string;
  arch: string;
  total_memory_mb: number;
  curseforge_available: boolean;
  msa_available: boolean;
}

// ------------------------------------------------------------------ Aufgaben

export type TaskStatus = "running" | "done" | "failed" | "cancelled";

export interface TaskInfo {
  id: string;
  kind: string;
  title: string;
  instance_id: string | null;
  progress: number | null;
  message: string | null;
  status: TaskStatus;
  error: string | null;
  started_at: number;
}

// ------------------------------------------------------------------ Accounts

export type AccountKind = "microsoft";

export interface Account {
  id: string;
  kind: AccountKind;
  username: string;
  uuid: string;
  skin_url: string | null;
  active: boolean;
  expires_at: number | null;
  needs_relogin: boolean;
}

export interface DeviceCode {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

// ------------------------------------------------------------------ Spiel

export interface McVersion {
  id: string;
  kind: "release" | "snapshot" | "old_beta" | "old_alpha";
  release_time: string;
}

export interface LoaderVersion {
  version: string;
  stable: boolean;
}

export type RunState = "preparing" | "running" | "stopped";

export interface GameState {
  instance_id: string;
  state: RunState;
  pid: number | null;
  started_at: number | null;
  exit_code: number | null;
  crashed: boolean;
  crash_report: string | null;
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "stdout" | "stderr" | "launcher";

export interface LogLine {
  seq: number;
  time: string | null;
  level: LogLevel;
  thread: string | null;
  logger: string | null;
  text: string;
}

export interface LogFile {
  name: string;
  size: number;
  modified: number;
  kind: "log" | "crash";
}

export interface MclogsResult {
  id: string;
  url: string;
  raw: string;
}

export interface JavaInstall {
  path: string;
  version: string;
  major: number;
  vendor: string | null;
  arch: string;
  managed: boolean;
}

// ------------------------------------------------------------------ Inhalte

export type Source = "modrinth" | "curseforge";
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
}

export type DependencyKind = "required" | "optional" | "incompatible" | "embedded";

export interface Dependency {
  project_id: string | null;
  version_id: string | null;
  kind: DependencyKind;
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
}

export interface ContentUpdate {
  file_name: string;
  kind: ContentKind;
  source: Source;
  project_id: string;
  current_version: string | null;
  new_version: ProjectVersion;
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
}
