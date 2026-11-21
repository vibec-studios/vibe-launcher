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
