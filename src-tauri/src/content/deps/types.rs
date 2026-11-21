use super::*;

// ------------------------------------------------------------------ Check

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueKind {
    MissingDependency,
    /// Pflicht-Abhängigkeit ist installiert, aber deaktiviert
    DisabledDependency,
    VersionMismatch,
    Incompatible,
    Duplicate,
    WrongLoader,
    WrongMinecraft,
    /// Loader-Installation fehlt teilweise, ist beschädigt oder zuletzt fehlgeschlagen (kein Mod-Problem;
    /// `mod_name` = Loader-Name, `file_name` leer). Behebt „Probleme beheben“ (Loader neu installieren).
    LoaderFiles,
}

/// Ein-Klick-Lösung.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Fix {
    /// Abhängigkeit installieren (`content_install`)
    Install { source: Source, project_id: String, title: String },
    /// Dateien entfernen (`content_remove`, Art mod)
    Remove { file_names: Vec<String> },
    /// Mod deaktivieren (`content_set_enabled`)
    Disable { file_name: String },
    /// Deaktivierte Mod wieder aktivieren (`content_set_enabled`); `title` = Name der Mod
    Enable { file_name: String, title: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct DepIssue {
    pub kind: IssueKind,
    /// "error" (Spiel startet vermutlich nicht) | "warning"
    pub severity: String,
    /// Betroffene Mod-Datei
    pub file_name: String,
    pub mod_name: String,
    /// Betroffene Mod-ID (Abhängigkeit / Konfliktpartner)
    pub target: Option<String>,
    /// Datei des Gegenparts (installierte Abhängigkeit mit falscher Version, Konfliktpartner)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other_file: Option<String>,
    pub message: String,
    pub fixes: Vec<Fix>,
}

pub(super) struct ModInfo<'a> {
    pub(super) s: &'a Scanned,
    pub(super) id: &'a str,
}
