import type { Lang } from "@/i18n/languages";
import type { DiscordLarge, DiscordSmall } from "./accounts";
import type { Appearance, UiMode } from "./appearance";
import type { FixBackup } from "./platform";
import type { VibeServices } from "./vibe";

// ------------------------------------------------------------------ Einstellungen / System

export type LaunchBehavior = "keep" | "minimize" | "hide";

export interface Settings {
  language: Lang;
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
  /** Discord: großes Bild */
  discord_large: DiscordLarge;
  /** Discord: Modpack-Icon statt des großen Bilds, wenn es eins gibt */
  discord_pack_icon: boolean;
  /** Discord: kleines Bild (rund, unten rechts) */
  discord_small: DiscordSmall;
  /** Discord: eigenes Bild (Pfad im Datenordner) */
  discord_image: string | null;
  wrapper_command: string | null;
  open_log_on_launch: boolean;
  console_on_launch: boolean;
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
  /** Sicherung vor „Probleme beheben“ und Performance-Mods */
  fix_backup: FixBackup;
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
  /** Weggeklickte Hinweise/Ankündigungen (je `id`, z. B. "domain-move-2026-11"; docs/DOMAINS.md) */
  dismissed_notices: string[];
  /** AFK-Modus (Experimentell, docs/AFK.md) */
  afk?: import("@/features/afk/types").AfkSettings;
  lean?: { enabled: boolean; reopen: boolean };
  prefer_dgpu?: boolean;
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
