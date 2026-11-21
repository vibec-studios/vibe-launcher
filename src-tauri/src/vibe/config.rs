use super::*;

/// Welcher Teilbereich gebraucht wird (für die Schalter in den Einstellungen).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    /// Nur Hauptschalter (Login, Meta, Gateway)
    Any,
    Social,
    Sharing,
    Hosting,
}

/// Offizielles Backend von Vibe Craft Studios. Nutzer können keine eigene Adresse einstellen.
/// Nur für offizielle Builds von Vibe Craft Studios. Forks müssen eigene Dienste verwenden (github.com/vibec-studios/.github/blob/main/SERVICES.md).
/// Seit dem Domain-Umzug `https://vibe.axolite.app`; die alte Adresse `https://vibe.henny.dev` wird weiter angenommen
/// (siehe `crate::domains`, docs/DOMAINS.md).
pub const DEFAULT_API_URL: &str = crate::domains::API_URL;

/// Basis-URL des Backends: immer [`DEFAULT_API_URL`]. Nur Debug-Builds dürfen sie für die lokale Entwicklung per
/// Env `VIBE_API_URL` überschreiben (z. B. `http://127.0.0.1:3000`); Release-Builds ignorieren die Variable.
pub fn api_base(_state: &AppState) -> String {
    normalize_base(&effective_api_url(debug_override("VIBE_API_URL")))
}

pub(super) fn effective_api_url(over: Option<String>) -> String {
    // Alte Standardadresse -> neue; eigene Adressen bleiben
    over.map(|o| crate::domains::migrate_api_url(&o)).unwrap_or_else(|| DEFAULT_API_URL.to_string())
}

pub use vibe_server_core::util::debug_override;

pub fn normalize_base(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

/// Prüft den Hauptschalter (und optional einen Teilbereich). Aus = Fehler, keine Verbindung.
pub fn ensure(state: &AppState, f: Feature) -> AppResult<String> {
    let s = state.settings().vibe;
    if !s.enabled {
        return Err(AppError::NotConfigured("Die Vibe-Dienste sind in den Einstellungen ausgeschaltet.".into()));
    }
    let on = match f {
        Feature::Any => true,
        Feature::Social => s.social,
        Feature::Sharing => s.sharing,
        Feature::Hosting => s.hosting,
    };
    if !on {
        return Err(AppError::NotConfigured("Diese Vibe-Funktion ist in den Einstellungen ausgeschaltet.".into()));
    }
    let base = api_base(state);
    if !(base.starts_with("https://") || base.starts_with("http://")) {
        return Err(AppError::Invalid("Die Vibe-Server-Adresse muss mit https:// beginnen.".into()));
    }
    Ok(base)
}

/// Wird nach dem Speichern der Einstellungen aufgerufen: Hauptschalter aus -> alle Verbindungen schließen.
pub fn on_settings_changed(state: &AppState) {
    if !state.settings().vibe.enabled {
        ws::close_all();
    }
}
