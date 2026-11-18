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

/** Start-Hooks je Instanz (Befehle in der System-Shell im Spielordner). */
export interface LaunchHooks {
  pre_launch: string | null;
  post_exit: string | null;
  /** Wrapper vor Java; ersetzt den globalen */
  wrapper: string | null;
}

export type PackSourceKind = "modrinth" | "curseforge" | "vlpack" | "prism" | "local" | "vibe";

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
  /** Fehlt bei älteren Mock-Daten */
  hooks?: LaunchHooks;
  source: PackSource | null;
  install_state: InstallState;
  version_id: string | null;
  created_at: number;
  last_played: number | null;
  play_time_secs: number;
  notes: string | null;
  /** Inhalte vor dem Start aktualisieren; null = globale Einstellung (Modpacks: aus) */
  auto_update_content: boolean | null;
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
  hooks?: LaunchHooks;
  notes?: string | null;
  auto_update_content?: boolean | null;
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
  /** "release" = nur GitHub-Releases, "dev" = jeder Commit */
  update_channel: "release" | "dev";
  /** Vibe-Online-Dienste – alle optional */
  vibe: VibeServices;
  discord_rpc: boolean;
  /** Discord: Server und Welt anzeigen */
  discord_details: boolean;
  wrapper_command: string | null;
  open_log_on_launch: boolean;
  reduce_motion: boolean;
  /** Mods/Packs/Shader vor jedem Start automatisch aktualisieren (je Instanz überschreibbar) */
  auto_update_content: boolean;
  stores: StoreConfig[];
  /** Aufbewahrte automatische Snapshots je Instanz */
  snapshot_keep: number;
  /** Vor jedem Spielstart geänderte Welten sichern */
  world_backup_on_launch: boolean;
  /** Aufbewahrte automatische Backups je Welt */
  world_backups_keep: number;
  /** MinecraftCapes-Cape/Ohren anzeigen (aus = keine Anfragen an api.minecraftcapes.net) */
  minecraftcapes: boolean;
  /** Darstellung (Akzent, Ton, Ecken, Dichte, Skalierung, Hintergrund) */
  appearance: Appearance;
  /** Bedienung: geführter Simple-Modus oder alle Funktionen (Expert). Siehe src/lib/mode.tsx */
  ui_mode: UiMode;
  /** Einrichtung beim ersten Start abgeschlossen (fehlt nur bei ganz neuen Nutzern) */
  onboarding_done: boolean;
  /** Hinweis „Neu: Simple-Modus“ gesehen (bestehende Nutzer, einmalig) */
  simple_hint_seen: boolean;
  /** Einführungs-Bubbles im Simple-Modus gesehen */
  simple_tour_done: boolean;
}

export type UiMode = "simple" | "expert";

/** dark = Schwarz (Standard), dim = Dunkelgrau, oled = auch Flächen fast schwarz */
export type AppearanceTone = "dark" | "dim" | "oled";
export type AppearanceRadius = "square" | "slight" | "round";
export type AppearanceDensity = "compact" | "normal";
export type BackgroundKind = "none" | "gradient" | "image" | "animated";
export type BackgroundGradient = "accent" | "dusk" | "ocean" | "ember" | "forest";
export type BackgroundAnimated = "aurora" | "particles" | "waves" | "blocks" | "custom";

/** Voreinstellungen, die mehrere Werte zugleich setzen (siehe THEMES in src/lib/appearance.ts) */
export type ThemeId = "standard" | "winter" | "graphite";
export type AppearanceFont = "inter" | "system";
export type AppearanceHeadings = "default" | "pixel";
export type AppearanceContrast = "normal" | "high";
export type AppearanceCards = "flat" | "outlined";
export type AppearanceMotion = "normal" | "more";
/** Einträge der Seitenleiste (Reihenfolge/Sichtbarkeit einstellbar) */
export type NavKey = "home" | "instances" | "servers" | "social" | "discover" | "skins" | "cosmetics" | "screenshots";

export interface Appearance {
  /** Gewähltes Theme; die Einzelwerte bleiben danach frei anpassbar */
  theme: ThemeId;
  /** Im Dezember/Januar automatisch das Winter-Theme zeigen */
  seasonal: boolean;
  accent: string;
  tone: AppearanceTone;
  radius: AppearanceRadius;
  density: AppearanceDensity;
  /** Prozent, 80–130 */
  ui_scale: number;
  background: {
    kind: BackgroundKind;
    gradient: BackgroundGradient;
    animated: BackgroundAnimated;
    /** Eigenes Bild (Pfad im Datenordner) */
    image: string | null;
    /** Eigenes Video/GIF/WebP (Pfad im Datenordner) */
    video: string | null;
    /** Abdunklung 0–90 % */
    dim: number;
    /** Unschärfe 0–40 px */
    blur: number;
  };
  /** Schrift für Fließtext */
  font: AppearanceFont;
  /** Überschriften: wie Fließtext oder Pixel-Schrift */
  headings: AppearanceHeadings;
  /** Schriftgröße in Prozent (90–115), unabhängig von der UI-Skalierung */
  font_scale: number;
  contrast: AppearanceContrast;
  /** Karten flach oder mit feiner Kante */
  cards: AppearanceCards;
  sidebar: {
    /** compact = nur Icons, wide = mit Beschriftung */
    mode: "compact" | "wide";
    /** Zuletzt gespielte Instanzen in der Seitenleiste */
    instances: boolean;
    order: NavKey[];
    hidden: NavKey[];
  };
  /** Instanz-Kacheln groß oder klein */
  icon_size: "large" | "small";
  /** Standardansicht der Bibliothek */
  library_view: "grid" | "list";
  /** Statusfarben (Hex) */
  status: { ok: string; warn: string; danger: string };
  /** „Mehr Animationen“ (Gegenstück zu „Animationen reduzieren“) */
  motion: AppearanceMotion;
  /** Übergang beim Seitenwechsel */
  nav_animations: boolean;
  /** Theme-Extras (wirken nur, wenn das Theme sie hat – z. B. Winter) */
  effects: {
    snow: boolean;
    /** Schneemenge 10–100 % */
    snow_amount: number;
    /** Ganz wenig Schnee sammelt sich auf Kanten */
    snow_settle: boolean;
    /** Theme-Maskottchen statt Logo in der Seitenleiste */
    mascot: boolean;
    /** Feine Frost-Details an Dialogkanten */
    frost: boolean;
  };
}

export interface StoreConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  icon: string | null;
}

/** Store mit Angaben aus der geladenen Datei (storesList). */
export interface StoreInfo {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  icon: string | null;
  /** Standard-Store (nur deaktivierbar) */
  builtin: boolean;
  homepage: string | null;
  description: string | null;
  project_count: number | null;
  error: string | null;
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

// ------------------------------------------------------------------ Skins & Capes

export type SkinVariant = "classic" | "slim";

export interface ActiveSkin {
  id: string;
  url: string;
  variant: SkinVariant;
  /** PNG als data:-URL (null, wenn nicht ladbar) */
  data_url: string | null;
}

export interface Cape {
  id: string;
  alias: string;
  url: string;
  state: "ACTIVE" | "INACTIVE";
  data_url: string | null;
}

export interface SkinProfile {
  account_id: string;
  username: string;
  skin: ActiveSkin | null;
  capes: Cape[];
}

/** Eintrag der lokalen Skin-Bibliothek (`skins/` im Datenordner). */
export interface LibrarySkin {
  id: string;
  name: string;
  variant: SkinVariant;
  file: string;
  added_at: number;
  /** "file" | "account:<name>" | "player:<name>" | "import:<launcher>" */
  source: string | null;
  /** Zugeordnetes Mojang-Cape (UUID), z. B. aus der Modrinth App */
  cape_id?: string | null;
  data_url: string;
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

// ------------------------------------------------------------------ Import aus anderen Launchern

/** folder = beliebiger Spielordner (nur über launcherScanDir) */
export type LauncherKind = "modrinth" | "prism" | "multimc" | "curseforge" | "atlauncher" | "norisk" | "folder";

export interface ExternalInstance {
  /** Instanzordner im fremden Launcher (Kennung für importExternal) */
  source_path: string;
  name: string;
  /** leer = unbekannt (dann warning gesetzt) */
  mc_version: string;
  loader: Loader;
  /** data:-URL */
  icon: string | null;
  mod_count: number;
  last_played: number | null;
  play_time_secs: number | null;
  size: number | null;
  warning: string | null;
  /** Vibe-Instanz-ID, falls schon importiert */
  imported_as: string | null;
}

export interface ExternalLauncher {
  id: LauncherKind;
  name: string;
  path: string;
  instances: ExternalInstance[];
}

// ------------------------------------------------------------------ Screenshots

export interface Screenshot {
  instance_id: string;
  file_name: string;
  /** Absoluter Pfad */
  path: string;
  size: number;
  width: number | null;
  height: number | null;
  /** ms seit 1970 (aus dem Dateinamen, sonst Änderungszeit) */
  taken_at: number;
}

export interface VibeServices {
  /** Hauptschalter: aus = keine Verbindung zum Vibe-Backend/Relay */
  enabled: boolean;
  social: boolean;
  presence: boolean;
  hosting: boolean;
  sharing: boolean;
}

// ------------------------------------------------------------------ Plattform

export type DiagnosisAction =
  | { kind: "disable_mod"; file: string }
  /** Deaktivierte Abhängigkeit wieder aktivieren */
  | { kind: "enable_mod"; file: string; name: string | null }
  | { kind: "install_dependency"; mod_id: string; name: string | null }
  | { kind: "set_java"; major: number }
  | { kind: "increase_ram"; suggest_mb: number }
  | { kind: "update_drivers" }
  | { kind: "upload" };

export interface Diagnosis {
  /** missing_dependency | wrong_minecraft | mixin | java_version | out_of_memory | heap_reserve | duplicate_mod |
   *  graphics | suspected_mod | exit_code */
  id: string;
  confidence: number;
  culprit: { mod_id: string | null; name: string | null; file: string | null } | null;
  params: Record<string, string>;
  actions: DiagnosisAction[];
  evidence: string | null;
}

export interface ServerEntry {
  name: string;
  /** host[:port] */
  ip: string;
  /** Base64-PNG (ohne data:-Präfix) */
  icon: string | null;
  accept_textures: boolean | null;
  hidden: boolean;
}

/** Ergebnis eines Server-List-Pings (Server-Liste der Instanz) */
export interface ServerPing {
  online: boolean;
  /** MOTD mit §-Farbcodes (§#rrggbb für Hex-Farben) */
  motd: string;
  players_online: number | null;
  players_max: number | null;
  players_sample: string[];
  version: string | null;
  protocol: number | null;
  /** data:image/png;base64,… */
  favicon: string | null;
  latency_ms: number | null;
  error: string | null;
}

export interface RecentServer {
  address: string;
  instance_id: string;
  last_played: number;
  play_time_secs: number;
}

export interface PlaySession {
  instance_id: string;
  start: number;
  end: number;
  world?: string | null;
  server?: string | null;
}

export type OptSyncCategory = "controls" | "sound" | "video" | "language" | "accessibility";

export interface OptSyncInfo {
  config: {
    master: Record<string, string>;
    source: string | null;
    updated_at: number | null;
    instances: Record<string, { enabled: boolean; categories: OptSyncCategory[] }>;
  };
  categories: OptSyncCategory[];
  counts: Partial<Record<OptSyncCategory, number>>;
}

/** Aktion von außen (Kommandozeile `--launch`, Deep-Link `vibelauncher://…`) – Frontend fragt immer nach. */
export type AppAction =
  | { kind: "install"; source: string; project_id: string; version: string | null }
  | { kind: "pack"; code: string }
  | { kind: "launch"; instance_id: string }
  | { kind: "join"; address: string; instance_id: string | null }
  | { kind: "invite"; id: string }
  | { kind: "play_link"; code: string };

// ------------------------------------------------------------------ Spiel-Links (docs/PLAY-LINKS.md)

export interface PlayLinkMod {
  source: "modrinth" | "curseforge";
  project_id: string;
  version_id?: string | null;
  kind?: "mod" | "resourcepack" | "shader" | "datapack";
}

export interface PlayLink {
  code: string;
  url: string;
  host: { uuid: string; name: string };
  relay_host: string;
  mc_version: string;
  loader: { kind: string; version: string | null };
  pack: { source: "modrinth" | "curseforge"; project_id: string; version_id: string; title: string | null } | null;
  mods: PlayLinkMod[];
  client_pack: string | null;
  world_name: string | null;
  max_players: number | null;
  /** Relay-Slot noch belegt (Host online) */
  active: boolean;
  expires_at: string;
}

export type JoinProblem = "version_unavailable" | "pack_unavailable" | "curseforge_unavailable" | "loader_unsupported";

export interface JoinPreview {
  instance_id: string | null;
  instance_name: string | null;
  create: boolean;
  pack_title: string | null;
  pack_icon: string | null;
  pack_version: string | null;
  mods: number;
  pack_files: number;
  client_pack: string | null;
  download_bytes: number | null;
  game_download: boolean;
  manual: string[];
  problem: JoinProblem | null;
  problem_detail: string | null;
}

/** `<spielordner>/.vibe/session.json` (vom Vibey Client) */
export interface PlayLinkSession {
  schema: number;
  state: "menu" | "singleplayer" | "hosting" | "multiplayer";
  server: string | null;
  world: string | null;
  play_link: string | null;
  players: number | null;
  max_players: number | null;
  updated_at: number;
}

export interface RunningSession {
  instance_id: string;
  session: PlayLinkSession;
}
// ------------------------------------------------------------------ Lokale Server (OWNER Game-Agent)

/** Wie Freunde den Server erreichen */
export type ServerConnection = "local" | "relay" | "playit";

export interface Server {
  id: string;
  name: string;
  /** Absoluter Bildpfad (PNG) oder null = Standard */
  icon: string | null;
  accent: string | null;
  mc_version: string;
  loader: Loader;
  /** Plugin-Software (Paper/Purpur/Folia); gesetzt -> loader ist Vanilla */
  platform?: ServerPlatform | null;
  /** Arbeitsspeicher in MiB (null = Standard 2048) */
  memory_mb: number | null;
  /** Fester Java-Pfad (null = automatisch) */
  java_path: string | null;
  /** Zusätzliche JVM-Argumente */
  jvm_args: string | null;
  /** = server-port in server.properties */
  port: number;
  /** Beim Launcher-Start mitstarten */
  auto_start: boolean;
  /** Nach Absturz automatisch neu starten (max. 3× in 10 min) */
  auto_restart: boolean;
  connection: ServerConnection;
  /** Minecraft-EULA akzeptiert (eula.txt) */
  eula: boolean;
  install_state: InstallState;
  created_at: number;
  last_started: number | null;
  /** Instanz, aus der der Server erstellt wurde */
  source_instance: string | null;
}

export type ServerRunState = "stopped" | "starting" | "running" | "stopping" | "crashed";

export type TunnelState = "connecting" | "online" | "claim" | "error" | "stopped";

export interface TunnelStatus {
  kind: ServerConnection;
  state: TunnelState;
  /** Öffentliche Adresse für Freunde (Relay/playit) */
  address: string | null;
  /** playit: Link zum Bestätigen im Browser */
  claim_url: string | null;
  /** Fehler-/Hinweistext (deutsch) */
  message: string | null;
}

/** Payload von `server://status` */
export interface ServerStatus {
  server_id: string;
  state: ServerRunState;
  pid: number | null;
  started_at: number | null;
  /** Namen der Spieler online */
  players: string[];
  max_players: number | null;
  exit_code: number | null;
  /** Läuft noch aus einer früheren Launcher-Sitzung (keine Konsole, Stopp = Beenden) */
  detached: boolean;
  tunnel: TunnelStatus | null;
}

export interface ServerAddresses {
  /** z. B. "localhost:25565" */
  local: string;
  /** LAN-Adressen "192.168.1.20:25565" */
  lan: string[];
}

export type ModSide = "both" | "client" | "server" | "unknown";

/** Mod einer Instanz mit Einordnung für den Server */
export interface ServerModCandidate {
  file_name: string;
  name: string | null;
  side: ModSide;
  /** Mod ist in der Instanz aktiv */
  enabled: boolean;
  /** Vorschlag: auf den Server kopieren */
  server_ok: boolean;
}

export type ServerPlatformKind = "paper" | "purpur" | "folia";

export interface ServerPlatform {
  kind: ServerPlatformKind;
  /** Build-Nummer; null = neuester stabiler */
  build: string | null;
}

export interface ServerCreate {
  name: string;
  mc_version: string;
  loader: Loader;
  platform?: ServerPlatform | null;
  /** Aus Instanz erstellen (Version/Loader der Instanz werden übernommen) */
  from_instance?: string | null;
  /** Dateinamen aus mods/ der Instanz, die kopiert werden (null = automatische Auswahl) */
  mods?: string[] | null;
  /** config/ und defaultconfigs/ der Instanz kopieren */
  copy_configs?: boolean;
  /** Ordnername unter saves/ der Instanz – wird die Server-Welt */
  world?: string | null;
  port?: number | null;
  memory_mb?: number | null;
}

/** Nur gesetzte Felder werden übernommen; `null` setzt optionale Felder zurück. */
export interface ServerPatch {
  name?: string;
  accent?: string | null;
  memory_mb?: number | null;
  java_path?: string | null;
  jvm_args?: string | null;
  port?: number;
  auto_start?: boolean;
  auto_restart?: boolean;
  connection?: ServerConnection;
}

export interface ServerCreated {
  server: Server;
  /** Task-ID der Installation (TaskInfo.instance_id = "server:<id>") */
  task_id: string;
}

export interface ServerPlayerEntry {
  name: string;
  uuid: string | null;
  /** OP-Level (nur ops) */
  level: number | null;
  /** Bann-Grund */
  reason: string | null;
}

export interface ServerPlayers {
  online: string[];
  whitelist_enabled: boolean;
  whitelist: ServerPlayerEntry[];
  ops: ServerPlayerEntry[];
  banned: ServerPlayerEntry[];
  /** name = IP-Adresse */
  banned_ips: ServerPlayerEntry[];
}

export type ServerPlayerList = "whitelist" | "ops" | "banned" | "banned_ips";

export interface ServerWorld {
  /** Ordnername */
  name: string;
  size: number;
  /** = level-name */
  active: boolean;
}

export interface ServerBackup {
  /** Dateiname im backups/-Ordner */
  name: string;
  world: string;
  size: number;
  created: number;
}

// ------------------------------------------------------------------ Inhalte: Seiten, Abhängigkeiten, Sets, Performance, Modpack-Updates

/** client = nur Client, both = Client & Server, server = nur Server */
export type Side = "client" | "both" | "server" | "unknown";

export interface SideInfo {
  file_name: string;
  kind: ContentKind;
  side: Side;
  enabled: boolean;
  /** z. B. "mods/sodium.jar" */
  rel_path: string;
}

export type DepIssueKind = "missing_dependency" | "disabled_dependency" | "version_mismatch" | "incompatible" | "duplicate" | "wrong_loader" | "wrong_minecraft";

export type DepFix =
  | { action: "install"; source: Source; project_id: string; title: string }
  | { action: "remove"; file_names: string[] }
  | { action: "disable"; file_name: string }
  /** Deaktivierte Abhängigkeit wieder aktivieren */
  | { action: "enable"; file_name: string; title: string };

export interface DepIssue {
  kind: DepIssueKind;
  severity: "error" | "warning";
  file_name: string;
  mod_name: string;
  target: string | null;
  /** Datei des Gegenparts (Abhängigkeit mit falscher Version, Konfliktpartner) */
  other_file?: string;
  message: string;
  fixes: DepFix[];
}

export interface ModSet {
  id: string;
  name: string;
  created: number;
  enabled_count: number;
  total_count: number;
}

export interface ModSets {
  active: string | null;
  /** aktuelle Auswahl weicht vom aktiven Set ab */
  active_modified: boolean;
  sets: ModSet[];
}

export interface PerfCandidate {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  version_number: string | null;
  available: boolean;
  installed: boolean;
  recommended: boolean;
  note: string | null;
}

export interface ModpackUpdate {
  source: Source;
  project_id: string;
  current_version: string | null;
  current_version_id: string | null;
  latest: ProjectVersion;
}

export interface ModpackPreviewFile {
  path: string;
  name: string;
  change: "added" | "updated" | "removed";
  old_path: string | null;
  side: Side;
}

export interface ModpackPreviewOverride {
  path: string;
  /** conflict = vom Nutzer geändert, seine Version bleibt */
  status: "new" | "update" | "conflict" | "remove";
}

export interface ModpackPreview {
  current_version: string | null;
  target: ProjectVersion;
  mc_from: string;
  mc_to: string;
  loader_from: Loader;
  loader_to: Loader;
  files: ModpackPreviewFile[];
  unchanged: number;
  overrides: ModpackPreviewOverride[];
  user_files: number;
  missing: MissingDownload[];
  /** ältere Installation ohne gespeicherten Stand */
  legacy: boolean;
}

// ------------------------------------------------------------------ Backups (Snapshots + Welt-Backups)

/** Snapshot einer Instanz (Mods, Configs, Packs, Optionen – keine Welten). */
export interface SnapshotInfo {
  id: string;
  name: string;
  created: number;
  /** Automatisch angelegt (z. B. „Vor Wiederherstellung“) – zählt zur Grenze `snapshot_keep` */
  auto: boolean;
  file_count: number;
  size: number;
}

/** ZIP-Backup einer Welt. `id` = "<weltordner>/<zeitstempel>" */
export interface WorldBackup {
  id: string;
  folder: string;
  world_name: string;
  created: number;
  size: number;
  /** Automatisch (vor Spielstart / vor Wiederherstellung) – zählt zur Grenze `world_backups_keep` */
  auto: boolean;
}

// ------------------------------------------------------------------ Dateien (Instanz- und Serverordner)

/** Bereich des Datei-Browsers */
export type FileScope = { kind: "instance"; id: string } | { kind: "server"; id: string };

export type FileKind = "dir" | "text" | "image" | "binary";

export interface FileEntry {
  name: string;
  /** Relativ zum Instanz-/Serverordner, mit "/" getrennt (z. B. "config/sodium-options.json") */
  path: string;
  is_dir: boolean;
  size: number;
  /** ms seit 1970 */
  modified: number;
  kind: FileKind;
  /** Anzahl direkter Einträge (nur Ordner) */
  children: number | null;
  has_backup: boolean;
}

export type FileLanguage = "json" | "json5" | "toml" | "properties" | "yaml" | "ini" | "javascript" | "snbt" | "log" | "text";

export interface FileContent {
  path: string;
  /** Leer, wenn nicht als Text geladen (Bild, binär, zu groß) */
  content: string;
  size: number;
  modified: number;
  has_backup: boolean;
  kind: Exclude<FileKind, "dir">;
  language: FileLanguage;
  readonly: boolean;
  readonly_reason: "too_large" | "binary" | "encoding" | "log" | "image" | null;
}

export interface FileValidationError {
  /** 1-basiert */
  line: number;
  /** 1-basiert */
  column: number;
  message: string;
}

export interface FileSearchHit {
  path: string;
  /** 1-basiert */
  line: number;
  text: string;
}

export interface FileSearchResult {
  hits: FileSearchHit[];
  /** Abgebrochen (Treffer-, Lese- oder Durchlauf-Limit) */
  truncated: boolean;
  files_scanned: number;
  /** Übersprungen, weil größer als 1 MB */
  files_skipped: number;
}

export interface FileFindResult {
  entries: FileEntry[];
  truncated: boolean;
}

export interface FileDeleteOutcome {
  deleted: number;
  /** In den Papierkorb verschoben */
  trashed: boolean;
  /** Papierkorb nicht möglich – nichts gelöscht */
  trash_error: string | null;
}

// ---------------------------------------------------------------- Vibe-Dienste (commands/vibe.rs)

export interface VibeIdentity {
  /** Account-ID bzw. `dev-<name>` (nur Debug) */
  scope: string;
  name: string;
  uuid: string;
  dev: boolean;
}

export interface VibeStatus {
  enabled: boolean;
  /** Backend-Adresse (immer das offizielle Backend; nur Debug-Builds: Env `VIBE_API_URL`) */
  api_url: string;
  gateway_url: string;
  identity: VibeIdentity | null;
  logged_in: boolean;
}

/** Wie `StoredTokens` im SDK */
export interface VibeTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionId: string;
}

export interface VibeHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | null;
}

export interface VibeHttpResponse {
  status: number;
  body: string;
  content_type: string | null;
  retry_after: string | null;
}

export type VibeWsEvent =
  | { type: "open"; id: string }
  | { type: "message"; id: string; data: string }
  | { type: "close"; id: string; code: number; reason: string };

export interface VibeShareOptions {
  visibility?: "public" | "unlisted" | "friends";
  description?: string | null;
  changelog?: string | null;
  /** Vorhandenes Pack: neue Version */
  code?: string | null;
  version?: string | null;
}

export interface VibeShareLink {
  code: string;
  url: string | null;
}

// ---------------------------------------------------------------- Probleme beheben (Autofix)

export type FixAction =
  | { kind: "install"; source: Source; project_id: string; title: string }
  | {
      kind: "replace";
      file_name: string;
      source: Source;
      project_id: string;
      version_id: string;
      title: string;
      from_version: string | null;
      to_version: string;
      /** CurseForge-Datei für andere Launcher gesperrt: nur verlinkt */
      manual: boolean;
    }
  | { kind: "enable"; file_name: string }
  | { kind: "disable"; file_name: string }
  /** path null: Java wird heruntergeladen */
  | { kind: "set_java"; major: number; path: string | null }
  | { kind: "set_ram"; mb: number };

export type FixReason =
  | "missing_dependency"
  | "disabled_dependency"
  | "version_mismatch"
  | "incompatible"
  | "known_conflict"
  | "duplicate"
  | "wrong_loader"
  | "wrong_minecraft"
  | "crash_suspect"
  | "dep_not_found"
  | "java_version"
  | "out_of_memory";

export interface FixStep {
  id: string;
  reason: FixReason;
  name: string;
  required_by: string[];
  action: FixAction;
  /** Alternative (Konflikt: die andere Mod deaktivieren) */
  alt: FixAction | null;
  alt_name: string | null;
  /** Nur nach ausdrücklicher Rückfrage */
  confirm: boolean;
  selected: boolean;
  from_crash: boolean;
}

export interface Unfixable {
  reason: "loader_version" | "version_mismatch" | "no_version" | "dep_not_found" | "graphics" | "heap_reserve";
  name: string;
  detail: string | null;
}

export interface FixPlan {
  steps: FixStep[];
  unfixable: Unfixable[];
  crash: boolean;
}

export interface FixReport {
  created: number;
  snapshot_id: string | null;
  results: { action: FixAction; ok: boolean; error: string | null }[];
  manual: MissingDownload[];
  prev_java: JavaOptions | null;
  undone: boolean;
}

export interface QuickCheck {
  errors: number;
  warnings: number;
  crashed: boolean;
}

// ------------------------------------------------------------------ Client-Packs

export type ClientPackId = "vibey" | "norisk" | "norisk-mini" | "essential" | (string & {});

export interface ClientPackInstall {
  version: string | null;
  files: string[];
  mc_version: string | null;
  loader: string | null;
  installed_at: number | null;
  disabled_by_user: boolean;
  missing: boolean;
  mismatch: boolean;
}

export interface ClientPackOffer {
  id: ClientPackId;
  category: "official" | "community";
  source: "vibe" | "norisk" | "modrinth";
  /** Packs derselben Gruppe schließen sich aus ("client") */
  group: string | null;
  vendor: string | null;
  homepage: string | null;
  projects: string[];
  /** null = unbekannt (Quelle nicht erreichbar) */
  available: boolean | null;
  reason: "loader" | "version" | "vibe_off" | "unreachable" | null;
  error: string | null;
  mc_versions: string[];
  latest_version: string | null;
  update_available: boolean;
  installed: ClientPackInstall | null;
}

export interface ClientPacksOverview {
  mc_version: string;
  loader: LoaderKind;
  vibe_enabled: boolean;
  packs: ClientPackOffer[];
}
