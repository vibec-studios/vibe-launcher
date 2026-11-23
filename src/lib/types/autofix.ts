import type { ContentUpdate, MissingDownload, Source } from "./content";
import type { DepIssue, ModpackUpdate } from "./contentTools";
import type { JavaOptions, Loader, LoaderKind } from "./instances";
import type { AnalysisInfo, Diagnosis, SnapshotScope } from "./platform";

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
  | { kind: "set_ram"; mb: number }
  /** Loader-Version umstellen und installieren */
  | { kind: "set_loader"; loader: LoaderKind; from: string | null; to: string }
  /** Loader in der eingestellten Version neu installieren */
  | { kind: "repair_loader"; loader: LoaderKind; version: string | null }
  /** Kaputte Config-Datei (config/…) sichern und zurücksetzen */
  | { kind: "reset_config"; path: string };

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
  | "out_of_memory"
  | "loader_too_old"
  | "loader_too_new"
  | "loader_unknown"
  | "loader_files_missing"
  | "loader_files_broken"
  | "loader_install_failed"
  | "mixin_conflict"
  | "mod_conflict"
  | "known_conflict"
  | "known_pair"
  | "broken_config";

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
  /** Zugehörige Absturzursache (Index in FixPlan.causes) */
  cause?: number | null;
  /** Zusatzangabe je Grund: wrong_loader -> Loader der Mod ("forge"), loader_too_* -> Anforderungen, loader_files_* -> Anzahl,
   *  known_pair -> Quelle */
  detail: string | null;
}

export interface Unfixable {
  reason: "loader_version" | "loader_offline" | "version_mismatch" | "no_version" | "dep_not_found" | "graphics" | "heap_reserve" | "ram_limit"
    | "native_memory" | "disk_full" | "invalid_jvm_flag" | "corrupt_archive" | "locked_world";
  name: string;
  detail: string | null;
  cause?: number | null;
}

export interface FixPlan {
  steps: FixStep[];
  unfixable: Unfixable[];
  crash: boolean;
  /** Absturzursachen (sicherste zuerst) mit Erklärung und Fundstelle */
  causes?: Diagnosis[];
  analysis?: AnalysisInfo | null;
}

export interface FixReport {
  created: number;
  snapshot_id: string | null;
  /** Bereiche der Sicherung (null = vollständig oder keine Sicherung) */
  snapshot_scopes?: SnapshotScope[] | null;
  results: { action: FixAction; ok: boolean; error: string | null }[];
  manual: MissingDownload[];
  prev_java: JavaOptions | null;
  /** Loader vor dem Durchlauf (nur wenn umgestellt) */
  prev_loader?: Loader | null;
  /** Zurückgesetzte Config-Dateien mit Sicherung */
  config_backups?: { path: string; backup: string }[];
  undone: boolean;
}

/** Ergebnis von „Neu prüfen“ (instance_refresh) */
export interface RefreshReport {
  items: number;
  /** null: Update-Prüfung fehlgeschlagen (update_error) */
  updates: ContentUpdate[] | null;
  update_error: string | null;
  modpack: ModpackUpdate | null;
  issues: DepIssue[];
  checked_at: number;
}

export interface QuickCheck {
  errors: number;
  warnings: number;
  crashed: boolean;
}
