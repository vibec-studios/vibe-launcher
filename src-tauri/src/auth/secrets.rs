//! Tokens im OS-Schlüsselbund (Windows: Anmeldeinformationsverwaltung).
//!
//! Windows begrenzt ein Credential auf 2560 Bytes (keyring speichert UTF-16, also ~1280 Zeichen).
//! Microsoft-/Minecraft-Tokens sind zusammen deutlich größer, darum wird der Secret-String in
//! Stücke aufgeteilt:
//!
//! ```text
//! <service> / <account-id>      "v1:<anzahl>"
//! <service> / <account-id>#0    Stück 0
//! <service> / <account-id>#1    Stück 1 ...
//! ```
//!
//! Inhalte werden nie geloggt.
use crate::error::{AppError, AppResult};
use crate::paths::Paths;
use sha1::{Digest, Sha1};

/// Zeichen pro Stück (ASCII-Tokens; 1000 * 2 Byte UTF-16 < 2560 Byte).
pub const CHUNK_CHARS: usize = 1000;
const HEADER_PREFIX: &str = "v1:";

pub struct SecretStore {
    service: String,
}

impl SecretStore {
    /// Testläufe mit eigenem Datenordner (`VIBE_LAUNCHER_HOME`) bekommen einen eigenen
    /// Service-Namen, damit sie nie echte Zugangsdaten überschreiben.
    pub fn new(paths: &Paths) -> Self {
        let service = if std::env::var_os("VIBE_LAUNCHER_HOME").is_some() {
            let h = hex::encode(Sha1::digest(paths.root.to_string_lossy().as_bytes()));
            format!("VibeLauncher-test-{}", &h[..10])
        } else {
            "VibeLauncher".to_string()
        };
        SecretStore { service }
    }

    #[cfg(test)]
    pub fn with_service(service: &str) -> Self {
        SecretStore { service: service.to_string() }
    }

    fn entry(&self, user: &str) -> AppResult<keyring::Entry> {
        keyring::Entry::new(&self.service, user).map_err(|e| AppError::msg(format!("Schlüsselbund nicht verfügbar: {e}")))
    }

    fn header_count(&self, id: &str) -> AppResult<Option<usize>> {
        match self.entry(id)?.get_password() {
            Ok(h) => Ok(h.strip_prefix(HEADER_PREFIX).and_then(|n| n.parse().ok())),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::msg(format!("Schlüsselbund lesen fehlgeschlagen: {e}"))),
        }
    }

    /// Secret speichern (überschreibt vorhandenes, räumt überzählige Stücke auf).
    pub fn save(&self, id: &str, secret: &str) -> AppResult<()> {
        let old = self.header_count(id).unwrap_or(None).unwrap_or(0);
        let chunks = split_chunks(secret, CHUNK_CHARS);
        let err = |e: keyring::Error| AppError::msg(format!("Zugangsdaten konnten nicht im Schlüsselbund gespeichert werden: {e}"));
        for (i, c) in chunks.iter().enumerate() {
            self.entry(&format!("{id}#{i}"))?.set_password(c).map_err(err)?;
        }
        self.entry(id)?.set_password(&format!("{HEADER_PREFIX}{}", chunks.len())).map_err(err)?;
        for i in chunks.len()..old {
            if let Ok(e) = self.entry(&format!("{id}#{i}")) {
                let _ = e.delete_credential();
            }
        }
        Ok(())
    }

    /// Secret laden. `None`, wenn nichts (vollständig) gespeichert ist.
    pub fn load(&self, id: &str) -> AppResult<Option<String>> {
        let Some(n) = self.header_count(id)? else { return Ok(None) };
        let mut parts = Vec::with_capacity(n);
        for i in 0..n {
            match self.entry(&format!("{id}#{i}"))?.get_password() {
                Ok(p) => parts.push(p),
                Err(keyring::Error::NoEntry) => return Ok(None),
                Err(e) => return Err(AppError::msg(format!("Schlüsselbund lesen fehlgeschlagen: {e}"))),
            }
        }
        Ok(Some(parts.concat()))
    }

    /// Alle Einträge eines Accounts löschen (fehlende Einträge sind kein Fehler).
    pub fn delete(&self, id: &str) {
        let n = self.header_count(id).unwrap_or(None).unwrap_or(0);
        // Auch ohne lesbaren Header ein paar Stücke versuchen (z. B. nach abgebrochenem Speichern)
        for i in 0..n.max(8) {
            if let Ok(e) = self.entry(&format!("{id}#{i}")) {
                let _ = e.delete_credential();
            }
        }
        if let Ok(e) = self.entry(id) {
            let _ = e.delete_credential();
        }
    }
}

/// String in Stücke von höchstens `max_chars` Zeichen teilen (an Zeichengrenzen).
pub fn split_chunks(s: &str, max_chars: usize) -> Vec<String> {
    let max_chars = max_chars.max(1);
    let chars: Vec<char> = s.chars().collect();
    if chars.is_empty() {
        return vec![String::new()];
    }
    chars.chunks(max_chars).map(|c| c.iter().collect()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_roundtrip() {
        for len in [0usize, 1, 999, 1000, 1001, 2500, 7321] {
            let s: String = (0..len).map(|i| (b'a' + (i % 26) as u8) as char).collect();
            let parts = split_chunks(&s, CHUNK_CHARS);
            assert!(parts.iter().all(|p| p.chars().count() <= CHUNK_CHARS));
            assert!(parts.iter().all(|p| p.encode_utf16().count() * 2 <= 2560));
            assert_eq!(parts.len(), if len == 0 { 1 } else { len.div_ceil(CHUNK_CHARS) });
            assert_eq!(parts.concat(), s);
        }
    }

    #[test]
    fn chunks_respect_char_boundaries() {
        let s = "äöü€😀".repeat(10);
        let parts = split_chunks(&s, 3);
        assert_eq!(parts.concat(), s);
        assert!(parts.iter().all(|p| p.chars().count() <= 3));
    }

    /// Echter Schlüsselbund – nur manuell: `cargo test -- --ignored keyring`
    #[test]
    #[ignore]
    fn keyring_roundtrip() {
        let store = SecretStore::with_service("VibeLauncher-unittest");
        let id = "unittest-account";
        let big: String = (0..4321).map(|i| (b'A' + (i % 26) as u8) as char).collect();
        store.save(id, &big).unwrap();
        assert_eq!(store.load(id).unwrap().as_deref(), Some(big.as_str()));
        // kleiner überschreiben -> überzählige Stücke weg
        store.save(id, "klein").unwrap();
        assert_eq!(store.load(id).unwrap().as_deref(), Some("klein"));
        assert!(matches!(keyring::Entry::new("VibeLauncher-unittest", "unittest-account#1").unwrap().get_password(), Err(keyring::Error::NoEntry)));
        store.delete(id);
        assert_eq!(store.load(id).unwrap(), None);
    }
}
