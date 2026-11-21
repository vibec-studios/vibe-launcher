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
