import type { Diagnosis } from "@/lib/types";
import { MODEL_CAUSES } from "@/features/vibefix/causes";

const KNOWN = [
  "missing_dependency",
  "outdated_dependency",
  "wrong_minecraft",
  "wrong_loader",
  "loader_version",
  "mixin",
  "mixin_conflict",
  "mod_conflict",
  "known_conflict",
  "broken_config",
  "java_version",
  "out_of_memory",
  "heap_reserve",
  "native_memory",
  "disk_full",
  "invalid_jvm_flag",
  "corrupt_archive",
  "locked_world",
  "duplicate_mod",
  "graphics",
  "suspected_mod",
  "exit_code",
  "unknown",
  ...MODEL_CAUSES,
];

const LOADER_CAUSES = ["wrong_loader", "loader_version", "loader_files", "exit_code", "unknown", "mixin", "missing_class", "linkage_error"];

/** Versionsbereich aus dem Log („15.0.140 or later“, „>=0.16.10“) in der UI-Sprache. */
export function localRange(range: string | undefined, t: (k: string, v?: Record<string, string | number>) => string): string {
  const r = (range ?? "").trim();
  const m = r.match(/^(?:>=?\s*)?(\S+?)\s+or\s+(?:later|above|newer|higher)$/i) ?? r.match(/^>=?\s*(\S+)$/);
  return m ? t("diag.range.min", { v: m[1] }) : r;
}

/** Klartext-Titel/Erklärung einer Diagnose. */
export function diagText(d: Diagnosis, t: (k: string, v?: Record<string, string | number>) => string) {
  const id = KNOWN.includes(d.id) ? d.id : "exit_code";
  const mod = d.culprit?.name || d.culprit?.mod_id || d.culprit?.file || t("diag.some_mod");
  const other = d.params.other_name || d.params.other_id || d.params.other_file?.replace(/\.jar$/, "") || t("diag.some_mod");
  const vars = { mod, other, present: "?", ...d.params, range: localRange(d.params.range, t), required: localRange(d.params.required, t) };
  // Abhängigkeit ist da, nur deaktiviert
  const off = id === "missing_dependency" && !!d.params.disabled_file;
  let key = off ? "diag.missing_dependency.text_disabled" : `diag.${id}.text`;
  // Andere Richtung: zu neue Java-Version bzw. die anfragende Mod ist zu alt
  if ((id === "java_version" || id === "outdated_dependency") && d.params.direction === "older") key = `diag.${id}.text_older`;
  if (id === "out_of_memory" && d.params.limit) key = "diag.out_of_memory.text_limit";
  let text = t(key, vars);
  if (id === "exit_code") text = t(`diag.exit.${d.params.hint ?? "exit_code"}`, vars);
  if (d.params.custom_loader && LOADER_CAUSES.includes(d.id)) text = `${text} ${t("cl.diag.note", { name: d.params.custom_loader })}`;
  return { title: t(off ? "diag.missing_dependency.title_disabled" : `diag.${id}.title`, vars), text };
}

/** Fundstelle „logs/latest.log, Zeile 12“ (ohne Datei: null). */
export function diagWhere(d: Diagnosis, t: (k: string, v?: Record<string, string | number>) => string): string | null {
  if (!d.source) return null;
  const source = d.source === "console" ? t("logs.live") : d.source;
  return d.line ? t("diag.where", { source, line: d.line }) : source;
}
