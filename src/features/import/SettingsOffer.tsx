// Einstellungen und Daten bereits importierter Instanzen nachträglich übernehmen
// (Backend: content/extsettings.rs, content/gamedata.rs).
// - ImportSettingsHint: einmaliger Hinweis unten links (wie „Neu: Einfacher Modus“), nur wenn es importierte Instanzen
//   gibt, deren Original noch da ist und abweicht (Einstellungen) bzw. in denen Daten fehlen (z. B. `xaero/`, Welten).
//   „Übernehmen“ setzt die vorausgewählten Werte und fügt fehlende Daten hinzu (nie überschreiben), „Ansehen“ öffnet
//   die Liste, „Nicht jetzt“ blendet bis zum nächsten Start aus, „Nie“ für immer. Erledigt/abgelehnt ->
//   `dismissed_notices` (beide IDs, siehe IMPORT_DATA_NOTICE).
// - SettingsReviewDialog: Liste je Instanz mit „alt → neu“ und Abschnitt „Dateien“ (fehlt / in der Quelle neuer),
//   einzeln an-/abwählbar; Überschreiben nur pro Eintrag ausdrücklich (vorher Snapshot bzw. Welt-Backup).
// - ImportSettingsRow: dauerhafter Eintrag in den Instanz-Einstellungen (Allgemein → Herkunft).
export { IMPORT_DATA_NOTICE, IMPORT_SETTINGS_NOTICE, dataLabel, openSettingsReview } from "./settings/state";
export { ImportSettingsHint } from "./settings/ImportSettingsHint";
export { SettingsReviewDialog } from "./settings/SettingsReviewDialog";
export { ImportSettingsRow } from "./settings/ImportSettingsRow";
