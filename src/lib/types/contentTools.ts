import type { ContentKind, MissingDownload, ProjectVersion, Source } from "./content";
import type { Loader } from "./instances";

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

export type DepIssueKind =
  | "missing_dependency"
  | "disabled_dependency"
  | "version_mismatch"
  | "incompatible"
  | "duplicate"
  | "wrong_loader"
  | "wrong_minecraft"
  /** Loader-Installation unvollständig/beschädigt/fehlgeschlagen (mod_name = Loader, file_name leer) */
  | "loader_files";

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
