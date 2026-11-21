import type { SnapshotScope } from "./platform";

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
  /** Teil-Snapshot: enthaltene Bereiche (null = vollständig) */
  scopes?: SnapshotScope[] | null;
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
