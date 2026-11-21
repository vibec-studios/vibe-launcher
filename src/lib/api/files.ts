import { call } from "./call";
import type * as T from "../types";

export const filesApi = {
  // ---------------------------------------------------------------- Backups (Snapshots + Welt-Backups)
  snapshotsList: (instanceId: string) => call<T.SnapshotInfo[]>("snapshots_list", { instanceId }),
  /** Gibt Task-ID zurück */
  snapshotCreate: (instanceId: string, name?: string | null) => call<string>("snapshot_create", { instanceId, name: name ?? null }),
  /** Gibt Task-ID zurück; legt vorher automatisch „Vor Wiederherstellung“ an */
  snapshotRestore: (instanceId: string, snapshotId: string) => call<string>("snapshot_restore", { instanceId, snapshotId }),
  snapshotDelete: (instanceId: string, snapshotId: string) => call<void>("snapshot_delete", { instanceId, snapshotId }),
  worldBackupsList: (instanceId: string) => call<T.WorldBackup[]>("world_backups_list", { instanceId }),
  /** Gibt Task-ID zurück */
  worldBackupCreate: (instanceId: string, folder: string) => call<string>("world_backup_create", { instanceId, folder }),
  /** Gibt Task-ID zurück; vorhandene Welt wird vorher gesichert */
  worldBackupRestore: (instanceId: string, backupId: string) => call<string>("world_backup_restore", { instanceId, backupId }),
  worldBackupDelete: (instanceId: string, backupId: string) => call<void>("world_backup_delete", { instanceId, backupId }),
  /** Gibt Task-ID zurück (Task gehört zur Ziel-Instanz) */
  worldCopy: (instanceId: string, folder: string, targetInstanceId: string) => call<string>("world_copy", { instanceId, folder, targetInstanceId }),
  /** Gibt Task-ID zurück */
  worldImportZip: (instanceId: string, path: string) => call<string>("world_import_zip", { instanceId, path }),
  backupsOpenFolder: (instanceId: string, kind: "worlds" | "snapshots") => call<void>("backups_open_folder", { instanceId, kind }),
  // ---------------------------------------------------------------- Dateien (Instanz-/Serverordner, commands/files.rs)
  /** Direkte Einträge eines Ordners ("" = Hauptordner) */
  filesList: (scope: T.FileScope, dir: string) => call<T.FileEntry[]>("files_list", { scope, dir }),
  filesStat: (scope: T.FileScope, path: string) => call<T.FileEntry>("files_stat", { scope, path }),
  /** Namenssuche im ganzen Ordner (max. 500 Treffer) */
  filesFind: (scope: T.FileScope, query: string) => call<T.FileFindResult>("files_find", { scope, query }),
  /** Volltextsuche in Textdateien bis 1 MB (max. 200 Treffer) */
  filesSearch: (scope: T.FileScope, query: string, dir?: string | null) => call<T.FileSearchResult>("files_search", { scope, query, dir: dir ?? null }),
  filesRead: (scope: T.FileScope, path: string) => call<T.FileContent>("files_read", { scope, path }),
  /** Sichert die alte Fassung (max. 10 je Datei) und schreibt atomar */
  filesWrite: (scope: T.FileScope, path: string, content: string) => call<T.FileContent>("files_write", { scope, path, content }),
  /** Letzte Sicherung zurückspielen (aktuelle Fassung wird selbst gesichert -> rückgängig machbar) */
  filesRestore: (scope: T.FileScope, path: string) => call<T.FileContent>("files_restore", { scope, path }),
  filesValidate: (path: string, content: string) => call<T.FileValidationError[]>("files_validate", { path, content }),
  /** Bildvorschau als data-URL */
  filesImage: (scope: T.FileScope, path: string) => call<string>("files_image", { scope, path }),
  /** Liefert den neuen relativen Pfad */
  filesCreate: (scope: T.FileScope, dir: string, name: string, isDir: boolean) => call<string>("files_create", { scope, dir, name, isDir }),
  filesRename: (scope: T.FileScope, path: string, newName: string) => call<string>("files_rename", { scope, path, newName }),
  filesDuplicate: (scope: T.FileScope, path: string) => call<string>("files_duplicate", { scope, path }),
  /** In den Papierkorb; `permanent` löscht endgültig */
  filesDelete: (scope: T.FileScope, paths: string[], permanent = false) => call<T.FileDeleteOutcome>("files_delete", { scope, paths, permanent }),
  /** Externe Dateien/Ordner (absolute Pfade) nach `dir` kopieren; liefert die neuen relativen Pfade */
  filesImport: (scope: T.FileScope, dir: string, sources: string[]) => call<string[]>("files_import", { scope, dir, sources }),
  filesAbsPath: (scope: T.FileScope, path: string) => call<string>("files_abs_path", { scope, path }),
  filesReveal: (scope: T.FileScope, path: string) => call<void>("files_reveal", { scope, path }),
};
