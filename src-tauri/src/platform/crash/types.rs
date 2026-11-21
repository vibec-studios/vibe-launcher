use super::*;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Culprit {
    pub mod_id: Option<String>,
    pub name: Option<String>,
    /// Dateiname im mods-Ordner, falls zugeordnet
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    /// Mod-Datei deaktivieren
    DisableMod { file: String },
    /// Deaktivierte Abhängigkeit (`.jar.disabled`) wieder aktivieren
    EnableMod { file: String, name: Option<String> },
    /// Abhängigkeit installieren (Modrinth-Slug/ID bzw. Mod-ID)
    InstallDependency { mod_id: String, name: Option<String> },
    /// Installierte Mod auf eine passende (neuere) Version tauschen
    UpdateMod { file: String, mod_id: String },
    /// Kaputte Config-Datei (relativ zum Spielordner, `config/…`) sichern und zurücksetzen
    ResetConfig { path: String },
    /// Java-Hauptversion verwenden
    SetJava { major: u32 },
    /// Arbeitsspeicher erhöhen (Vorschlag in MB)
    IncreaseRam { suggest_mb: u32 },
    /// Grafiktreiber aktualisieren (nur Hinweis + Link)
    UpdateDrivers,
    /// Log/Report zu mclo.gs hochladen
    Upload,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Diagnosis {
    /// Kennung der Ursache: missing_dependency, outdated_dependency, wrong_minecraft, wrong_loader, loader_version,
    /// mixin, mixin_conflict, mod_conflict, known_conflict, java_version, out_of_memory, heap_reserve, duplicate_mod,
    /// broken_config, graphics, suspected_mod, exit_code
    pub id: String,
    /// 0–100: wie sicher die Regel ist (zum Sortieren)
    pub confidence: u8,
    pub culprit: Option<Culprit>,
    /// Kurze Parameter für die Klartext-Texte im Frontend (z. B. benötigte Version)
    pub params: BTreeMap<String, String>,
    pub actions: Vec<Action>,
    /// Gefundene Fundstelle (eine Zeile) zum Anzeigen
    pub evidence: Option<String>,
    /// Datei der Fundstelle (`logs/latest.log`, `crash-reports/…`, `console`)
    pub source: Option<String>,
    /// Zeile in dieser Datei (ab 1)
    pub line: Option<u32>,
    /// Regel aus `patterns.toml`
    pub rule: Option<String>,
}

impl Diagnosis {
    pub(super) fn new(id: &str, confidence: u8) -> Self {
        Diagnosis {
            id: id.into(),
            confidence,
            culprit: None,
            params: BTreeMap::new(),
            actions: vec![],
            evidence: None,
            source: None,
            line: None,
            rule: None,
        }
    }
    pub(super) fn param(mut self, k: &str, v: impl Into<String>) -> Self {
        self.params.insert(k.into(), v.into());
        self
    }
    pub(super) fn culprit(mut self, mod_id: Option<&str>, name: Option<&str>) -> Self {
        if mod_id.is_some() || name.is_some() {
            self.culprit = Some(Culprit { mod_id: mod_id.map(Into::into), name: name.map(Into::into), file: None });
        }
        self
    }
    pub(super) fn action(mut self, a: Action) -> Self {
        self.actions.push(a);
        self
    }
    pub(super) fn evidence(mut self, line: &str) -> Self {
        self.evidence = Some(line.trim().chars().take(300).collect());
        self
    }
}
