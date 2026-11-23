use super::*;

// ------------------------------------------------------------------ Typen

/// Ein ausführbarer Schritt (kommt so auch vom Frontend zurück).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FixAction {
    /// Projekt (inkl. Pflicht-Abhängigkeiten) installieren
    Install { source: Source, project_id: String, title: String },
    /// Installierte Datei durch eine passende Version ersetzen. `manual`: Datei ist auf CurseForge für andere
    /// Launcher gesperrt -> nur vormerken und verlinken.
    Replace {
        file_name: String,
        source: Source,
        project_id: String,
        version_id: String,
        title: String,
        from_version: Option<String>,
        to_version: String,
        #[serde(default)]
        manual: bool,
    },
    Enable { file_name: String },
    Disable { file_name: String },
    /// Java-Hauptversion für die Instanz einstellen; `path = None` -> wird heruntergeladen
    SetJava {
        major: u32,
        #[serde(default)]
        path: Option<String>,
    },
    /// Maximalen Arbeitsspeicher setzen (MB)
    SetRam { mb: u32 },
    /// Loader-Version der Instanz umstellen und installieren (`from` nur zur Anzeige)
    SetLoader {
        loader: LoaderKind,
        #[serde(default)]
        from: Option<String>,
        to: String,
    },
    /// Loader in der eingestellten Version neu installieren (alle Dateien prüfen und neu laden)
    RepairLoader {
        loader: LoaderKind,
        #[serde(default)]
        version: Option<String>,
    },
    /// Kaputte Config-Datei (relativ zum Spielordner, `config/…`) sichern und zurücksetzen – die Mod legt sie beim
    /// nächsten Start mit Standardwerten neu an
    ResetConfig { path: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct FixStep {
    pub id: String,
    /// Grund: missing_dependency | disabled_dependency | version_mismatch | incompatible | known_conflict | duplicate |
    /// wrong_loader | wrong_minecraft | crash_suspect | dep_not_found | java_version | out_of_memory |
    /// loader_too_old | loader_too_new | loader_unknown | loader_files_missing | loader_files_broken | loader_install_failed |
    /// mixin_conflict | mod_conflict | known_conflict (aus dem Absturz) | known_pair (Liste) | broken_config
    pub reason: String,
    /// Betroffene Mod (Anzeigename)
    pub name: String,
    /// Mods, die das brauchen (fehlende/deaktivierte Abhängigkeit)
    pub required_by: Vec<String>,
    pub action: FixAction,
    /// Alternative (bei Konflikten: die andere Mod deaktivieren)
    pub alt: Option<FixAction>,
    pub alt_name: Option<String>,
    /// Nur nach ausdrücklicher Rückfrage (Konflikte, vermutete Crash-Ursache)
    pub confirm: bool,
    /// Standardmäßig ausgewählt
    pub selected: bool,
    /// Aus der Crash-Analyse
    pub from_crash: bool,
    /// Zugehörige Absturzursache (Index in `FixPlan::causes`)
    pub cause: Option<usize>,
    /// Zusatzangabe je Grund (sprachneutral): wrong_loader -> Loader der Mod ("forge"), loader_too_* -> Anforderungen
    /// („Create >=0.16.10“), loader_files_* -> Anzahl Dateien, known_pair -> Quelle
    pub detail: Option<String>,
}

/// Erkannt, aber nicht automatisch behebbar.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Unfixable {
    /// loader_version | loader_offline | no_version | dep_not_found | graphics | heap_reserve | ram_limit
    pub reason: String,
    pub name: String,
    pub detail: Option<String>,
    /// Zugehörige Absturzursache (Index in `FixPlan::causes`)
    pub cause: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FixPlan {
    pub steps: Vec<FixStep>,
    pub unfixable: Vec<Unfixable>,
    /// Die letzte Sitzung ist abgestürzt und wurde mit ausgewertet
    pub crash: bool,
    /// Absturzursachen (sicherste zuerst) mit Erklärung und Fundstelle; Schritte verweisen per `cause` darauf
    pub causes: Vec<Diagnosis>,
    pub analysis: Option<crash::AnalysisInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub action: FixAction,
    pub ok: bool,
    pub error: Option<String>,
}

/// Ergebnis des letzten Durchlaufs (`instances/<id>/autofix.json`), Grundlage für „Rückgängig“.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixReport {
    pub created: i64,
    pub snapshot_id: Option<String>,
    /// Bereiche der Sicherung (`None` = vollständig bzw. keine Sicherung, siehe `snapshot_id`)
    #[serde(default)]
    pub snapshot_scopes: Option<Vec<String>>,
    pub results: Vec<StepResult>,
    /// Gesperrte Downloads, die manuell geladen werden müssen
    pub manual: Vec<MissingDownload>,
    /// Java-Einstellungen vor dem Durchlauf (nur wenn Java/RAM geändert wurde)
    pub prev_java: Option<JavaOptions>,
    /// Loader vor dem Durchlauf (nur wenn die Loader-Version umgestellt wurde)
    #[serde(default)]
    pub prev_loader: Option<Loader>,
    /// Zurückgesetzte Config-Dateien mit ihrer Sicherung
    #[serde(default)]
    pub config_backups: Vec<ConfigBackup>,
    #[serde(default)]
    pub undone: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConfigBackup {
    /// Relativ zum Spielordner (`config/…`)
    pub path: String,
    /// Absoluter Pfad der Sicherung (`instances/<id>/autofix-config/<zeit>/…`)
    pub backup: String,
}

/// Schnelle Prüfung ohne Netz (vor dem Start).
#[derive(Debug, Clone, Serialize)]
pub struct QuickCheck {
    pub errors: u32,
    pub warnings: u32,
    /// Letzte Sitzung abgestürzt
    pub crashed: bool,
}
