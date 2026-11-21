use super::*;

impl Settings {
    pub fn load(path: &Path) -> Settings {
        match std::fs::read(path) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|e| {
                tracing::warn!("settings.json unlesbar, Standardwerte: {e}");
                // Kaputte Datei = bestehender Nutzer: kein Onboarding, Expert bleibt
                Settings { onboarding_done: true, ..Settings::default() }
            }),
            Err(_) => Settings::default(),
        }
    }

    /// Wie `load`, erkennt aber bestehende Nutzer ohne `settings.json` (nie etwas eingestellt, aber schon Konten
    /// oder Instanzen): für sie gilt das Onboarding als erledigt, der Modus bleibt Expert.
    pub fn load_for(paths: &crate::paths::Paths) -> Settings {
        let file = paths.settings_file();
        let mut s = Settings::load(&file);
        if !file.exists() && !s.onboarding_done && has_existing_data(paths) {
            s.onboarding_done = true;
            s.vibe.enabled = true;
            s.minecraftcapes = true;
        }
        s.sanitize_mode();
        s.migrate_stores();
        s
    }

    /// Gespeicherte Adresse des offiziellen Stores (GitHub Pages) still auf die neue umstellen; eigene Stores bleiben.
    pub fn migrate_stores(&mut self) {
        for st in &mut self.stores {
            st.url = crate::domains::migrate_store_url(&st.url);
        }
    }

    /// Weggeklickte Hinweise: nur gültige IDs, ohne Doppelte, höchstens 200 (die neuesten).
    pub fn sanitize_notices(&mut self) {
        let mut out: Vec<String> = Vec::new();
        for id in &self.dismissed_notices {
            let id = id.trim();
            if crate::vibe::announcements::valid_id(id) && !out.iter().any(|x| x == id) {
                out.push(id.to_string());
            }
        }
        let n = out.len();
        if n > 200 {
            out.drain(..n - 200);
        }
        self.dismissed_notices = out;
    }

    /// Unbekannten Modus auf "expert" setzen.
    pub fn sanitize_mode(&mut self) {
        if self.ui_mode != "simple" {
            self.ui_mode = "expert".into();
        }
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        crate::util::write_json_atomic(path, self)
    }

    /// Effektiver CurseForge-Key: Einstellung > Build-Zeit (`CURSEFORGE_API_KEY`).
    pub fn curseforge_key(&self) -> Option<String> {
        self.curseforge_api_key
            .clone()
            .filter(|k| !k.trim().is_empty())
            .or_else(|| option_env!("CURSEFORGE_API_KEY").map(str::to_string))
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
    }

    /// Effektive Azure-Client-ID: Einstellung > Build-Zeit (`VIBE_MSA_CLIENT_ID`).
    pub fn msa_client(&self) -> Option<String> {
        self.msa_client_id
            .clone()
            .filter(|k| !k.trim().is_empty())
            .or_else(|| option_env!("VIBE_MSA_CLIENT_ID").map(str::to_string))
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
    }
}
