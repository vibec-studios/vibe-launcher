//! Accounts: nur Microsoft (Device-Code-Flow: MSA -> Xbox Live -> XSTS -> Minecraft Services).
//!
//! OWNER: Auth-Agent. Öffentliche Typen/Signaturen sind Teil des Vertrags (docs/CONTRACT.md).
//!
//! Speicherung: `accounts.json` enthält nur Metadaten (keine Tokens). MSA-Refresh-Token und
//! Minecraft-Access-Token liegen als JSON im OS-Schlüsselbund (siehe [`secrets`]).
pub mod msa;
pub mod secrets;
pub mod skin_import;
pub mod skins;

use crate::error::{AppError, AppResult};
use crate::events;
use crate::paths::Paths;
use crate::util::now_ms;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccountKind {
    /// Einzige Account-Art (Offline-/Cracked-Accounts gibt es bewusst nicht).
    Microsoft,
}

/// Account, wie ihn das Frontend sieht (ohne Tokens).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    /// Lokale ID (stabil), = Minecraft-UUID ohne Bindestriche
    pub id: String,
    pub kind: AccountKind,
    pub username: String,
    /// Minecraft-UUID mit Bindestrichen
    pub uuid: String,
    /// URL des Skins (falls bekannt)
    pub skin_url: Option<String>,
    pub active: bool,
    /// Ablauf des Minecraft-Tokens (ms seit Epoch)
    pub expires_at: Option<i64>,
    /// Refresh fehlgeschlagen -> Nutzer muss sich neu anmelden
    pub needs_relogin: bool,
}

/// Device-Code für den Microsoft-Login.
#[derive(Debug, Clone, Serialize)]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

/// Was der Spielstart braucht.
#[derive(Debug, Clone)]
pub struct LaunchAccount {
    pub username: String,
    /// UUID ohne Bindestriche
    pub uuid: String,
    pub access_token: String,
    /// "msa" oder "legacy"
    pub user_type: String,
    pub xuid: Option<String>,
    pub client_id: Option<String>,
}

/// Minecraft-Token so früh erneuern (vor Ablauf).
const REFRESH_MARGIN_MS: i64 = 5 * 60 * 1000;

// ------------------------------------------------------------------ Speicherformat

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAccount {
    id: String,
    kind: AccountKind,
    username: String,
    uuid: String,
    #[serde(default)]
    skin_url: Option<String>,
    #[serde(default)]
    expires_at: Option<i64>,
    #[serde(default)]
    needs_relogin: bool,
    #[serde(default)]
    xuid: Option<String>,
    #[serde(default)]
    added_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AccountsFile {
    #[serde(default)]
    active: Option<String>,
    #[serde(default, deserialize_with = "lenient_accounts")]
    accounts: Vec<StoredAccount>,
}

/// Unlesbare/unbekannte Einträge (z. B. alte Account-Arten) überspringen statt die ganze Datei zu verwerfen.
fn lenient_accounts<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<StoredAccount>, D::Error> {
    let raw: Vec<serde_json::Value> = Deserialize::deserialize(d)?;
    Ok(raw
        .into_iter()
        .filter_map(|v| match serde_json::from_value::<StoredAccount>(v) {
            Ok(a) => Some(a),
            Err(e) => {
                tracing::warn!("accounts.json: Eintrag übersprungen ({e})");
                None
            }
        })
        .collect())
}

/// Geheimnisse eines Microsoft-Accounts (nur im Schlüsselbund).
#[derive(Clone, Default, Serialize, Deserialize)]
struct Secrets {
    #[serde(default)]
    msa_refresh_token: Option<String>,
    #[serde(default)]
    mc_access_token: Option<String>,
}

struct PendingLogin {
    generation: u64,
    client_id: String,
    device_code: String,
    interval: u64,
    deadline: Instant,
    cancel: CancellationToken,
}

pub struct AuthState {
    paths: Paths,
    app: AppHandle,
    store: Mutex<AccountsFile>,
    secrets: secrets::SecretStore,
    /// Cache, damit der Schlüsselbund nicht bei jedem Start gelesen wird (und als Rückfall,
    /// falls er nicht beschreibbar ist).
    secret_cache: Mutex<HashMap<String, Secrets>>,
    pending: Mutex<Option<PendingLogin>>,
    generation: std::sync::atomic::AtomicU64,
    /// Refreshs nacheinander (Refresh-Tokens rotieren)
    refresh_lock: tokio::sync::Mutex<()>,
    /// Lokale Skin-Bibliothek
    pub skins: skins::Library,
}

impl AuthState {
    pub fn load(paths: Paths, app: AppHandle) -> Arc<Self> {
        let file = paths.accounts_file();
        let mut store: AccountsFile = match std::fs::read(&file) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|e| {
                tracing::warn!("accounts.json unlesbar ({e}) – Sicherung als accounts.json.bak");
                let _ = std::fs::copy(&file, file.with_extension("json.bak"));
                AccountsFile::default()
            }),
            Err(_) => AccountsFile::default(),
        };
        if store.active.as_ref().map_or(true, |a| !store.accounts.iter().any(|x| &x.id == a)) {
            store.active = store.accounts.first().map(|a| a.id.clone());
        }
        let secrets = secrets::SecretStore::new(&paths);
        let skins = skins::Library::load(&paths.root);
        Arc::new(AuthState {
            paths,
            app,
            store: Mutex::new(store),
            secrets,
            secret_cache: Mutex::new(HashMap::new()),
            pending: Mutex::new(None),
            generation: Default::default(),
            refresh_lock: tokio::sync::Mutex::new(()),
            skins,
        })
    }

    pub fn list(&self) -> Vec<Account> {
        let s = self.store.lock();
        s.accounts.iter().map(|a| to_public(a, s.active.as_deref())).collect()
    }

    fn get(&self, id: &str) -> AppResult<Account> {
        self.list().into_iter().find(|a| a.id == id).ok_or_else(|| AppError::NotFound("Account".into()))
    }

    /// Speichern + `accounts://changed`.
    fn persist(&self) -> AppResult<()> {
        let res = {
            let s = self.store.lock();
            crate::util::write_json_atomic(&self.paths.accounts_file(), &*s)
        };
        events::emit(&self.app, events::ACCOUNTS_CHANGED, &self.list());
        res
    }

    fn upsert(&self, acc: StoredAccount) {
        let mut s = self.store.lock();
        match s.accounts.iter_mut().find(|a| a.id == acc.id) {
            Some(existing) => {
                let added = existing.added_at;
                *existing = acc;
                existing.added_at = added;
            }
            None => s.accounts.push(acc),
        }
        if s.active.is_none() {
            s.active = s.accounts.first().map(|a| a.id.clone());
        }
    }

    // -------------------------------------------------------------- Secrets

    fn load_secrets(&self, id: &str) -> Secrets {
        if let Some(s) = self.secret_cache.lock().get(id) {
            return s.clone();
        }
        let s = match self.secrets.load(id) {
            Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_else(|_| {
                tracing::warn!("Zugangsdaten für Account {id} im Schlüsselbund unlesbar");
                Secrets::default()
            }),
            Ok(None) => Secrets::default(),
            Err(e) => {
                tracing::warn!("Zugangsdaten für Account {id} nicht lesbar: {e}");
                Secrets::default()
            }
        };
        self.secret_cache.lock().insert(id.to_string(), s.clone());
        s
    }

    fn store_secrets(&self, id: &str, s: &Secrets) {
        self.secret_cache.lock().insert(id.to_string(), s.clone());
        let json = match serde_json::to_string(s) {
            Ok(j) => j,
            Err(_) => return,
        };
        if let Err(e) = self.secrets.save(id, &json) {
            // Sitzung funktioniert weiter (Cache); nach Neustart ist eine neue Anmeldung nötig.
            tracing::error!("Zugangsdaten für Account {id} nicht gespeichert: {e}");
        }
    }

    fn delete_secrets(&self, id: &str) {
        self.secret_cache.lock().remove(id);
        self.secrets.delete(id);
    }

    // -------------------------------------------------------------- Verwaltung

    pub fn remove(&self, id: &str) -> AppResult<()> {
        {
            let mut s = self.store.lock();
            let before = s.accounts.len();
            s.accounts.retain(|a| a.id != id);
            if s.accounts.len() == before {
                return Err(AppError::NotFound("Account".into()));
            }
            if s.active.as_deref() == Some(id) {
                s.active = s.accounts.first().map(|a| a.id.clone());
            }
        }
        self.delete_secrets(id);
        tracing::info!("Account {id} entfernt");
        self.persist()
    }

    pub fn set_active(&self, id: &str) -> AppResult<()> {
        {
            let mut s = self.store.lock();
            if !s.accounts.iter().any(|a| a.id == id) {
                return Err(AppError::NotFound("Account".into()));
            }
            s.active = Some(id.to_string());
        }
        self.persist()
    }

    // -------------------------------------------------------------- Microsoft-Login

    /// Device-Code anfordern (bricht einen laufenden Login ab).
    pub async fn msa_begin(&self, state: &crate::state::AppState) -> AppResult<DeviceCode> {
        let client_id = msa_client_id(state)?;
        if let Some(old) = self.pending.lock().take() {
            old.cancel.cancel();
        }
        let dc = msa::request_device_code(&state.net.client, &client_id).await?;
        let generation = self.generation.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        *self.pending.lock() = Some(PendingLogin {
            generation,
            client_id,
            device_code: dc.device_code.clone(),
            interval: dc.interval.max(1),
            deadline: Instant::now() + Duration::from_secs(dc.expires_in),
            cancel: CancellationToken::new(),
        });
        tracing::info!("Microsoft-Login gestartet (Code gültig {} s)", dc.expires_in);
        let message = format!("Öffne {} im Browser und gib den Code {} ein.", dc.verification_uri, dc.user_code);
        Ok(DeviceCode {
            user_code: dc.user_code,
            verification_uri: dc.verification_uri,
            expires_in: dc.expires_in,
            interval: dc.interval,
            message,
        })
    }

    /// Wartet auf die Eingabe des Codes und legt den Account an.
    pub async fn msa_wait(&self, state: &crate::state::AppState) -> AppResult<Account> {
        let (generation, client_id, device_code, mut interval, deadline, cancel) = {
            let p = self.pending.lock();
            let p = p.as_ref().ok_or_else(|| AppError::Invalid("Kein laufender Microsoft-Login – bitte zuerst starten.".into()))?;
            (p.generation, p.client_id.clone(), p.device_code.clone(), p.interval, p.deadline, p.cancel.clone())
        };
        let client = state.net.client.clone();
        let flow = async {
            let mut net_errors = 0;
            let tokens = loop {
                tokio::time::sleep(Duration::from_secs(interval)).await;
                if Instant::now() > deadline {
                    return Err(AppError::Auth("Der Anmeldecode ist abgelaufen – bitte den Login erneut starten.".into()));
                }
                match msa::poll_device_code(&client, &client_id, &device_code).await {
                    Ok(msa::Poll::Pending) => net_errors = 0,
                    Ok(msa::Poll::SlowDown) => interval += 5,
                    Ok(msa::Poll::Done(t)) => break t,
                    Err(AppError::Http(e)) if net_errors < 5 => {
                        net_errors += 1;
                        tracing::warn!("Login-Polling: Netzwerkfehler ({e}), neuer Versuch");
                    }
                    Err(e) => return Err(e),
                }
            };
            let mc = msa::minecraft_login(&client, &tokens.access_token).await?;
            Ok::<_, AppError>((tokens, mc))
        };
        let result = tokio::select! {
            _ = cancel.cancelled() => Err(AppError::Cancelled),
            r = flow => r,
        };
        {
            let mut p = self.pending.lock();
            if p.as_ref().is_some_and(|p| p.generation == generation) {
                *p = None;
            }
        }
        let (tokens, mc) = match result {
            Ok(v) => v,
            Err(e) => {
                if !matches!(e, AppError::Cancelled) {
                    tracing::warn!("Microsoft-Login fehlgeschlagen: {e}");
                }
                return Err(e);
            }
        };
        let id = self.apply_login(&mc, tokens.refresh_token)?;
        tracing::info!("Microsoft-Account {} angemeldet", mc.profile.name);
        self.get(&id)
    }

    pub fn msa_cancel(&self) {
        if let Some(p) = self.pending.lock().take() {
            p.cancel.cancel();
        }
    }

    /// Ergebnis eines Logins/Refreshs übernehmen. Gibt die Account-ID zurück.
    fn apply_login(&self, mc: &msa::McLogin, refresh_token: Option<String>) -> AppResult<String> {
        let id = mc.profile.id.to_lowercase();
        let uuid = uuid::Uuid::parse_str(&id).map(|u| u.hyphenated().to_string()).unwrap_or_else(|_| id.clone());
        let old = self.load_secrets(&id);
        self.store_secrets(
            &id,
            &Secrets {
                msa_refresh_token: refresh_token.or(old.msa_refresh_token),
                mc_access_token: Some(mc.access_token.clone()),
            },
        );
        self.upsert(StoredAccount {
            id: id.clone(),
            kind: AccountKind::Microsoft,
            username: mc.profile.name.clone(),
            uuid,
            skin_url: mc.profile.skin_url.clone(),
            expires_at: Some(now_ms() + mc.expires_in as i64 * 1000),
            needs_relogin: false,
            xuid: mc.xuid.clone(),
            added_at: now_ms(),
        });
        self.persist()?;
        Ok(id)
    }

    fn mark_relogin(&self, id: &str) {
        {
            let mut s = self.store.lock();
            if let Some(a) = s.accounts.iter_mut().find(|a| a.id == id) {
                a.needs_relogin = true;
            }
        }
        let _ = self.persist();
    }

    /// Microsoft-Tokens erneuern (komplette Kette ab Refresh-Token).
    /// `force = false`: nur, wenn der Minecraft-Token bald abläuft.
    pub async fn refresh(&self, state: &crate::state::AppState, id: &str, force: bool) -> AppResult<Account> {
        let _guard = self.refresh_lock.lock().await;
        let acc = self.store.lock().accounts.iter().find(|a| a.id == id).cloned().ok_or_else(|| AppError::NotFound("Account".into()))?;
        if !force && !acc.needs_relogin && acc.expires_at.is_some_and(|e| e - now_ms() > REFRESH_MARGIN_MS) && self.load_secrets(id).mc_access_token.is_some() {
            return self.get(id); // inzwischen von einem anderen Aufruf erneuert
        }
        let client_id = msa_client_id(state)?;
        let Some(refresh_token) = self.load_secrets(id).msa_refresh_token else {
            self.mark_relogin(id);
            return Err(AppError::Auth(format!("Für {} sind keine Zugangsdaten gespeichert – bitte neu mit Microsoft anmelden.", acc.username)));
        };
        let client = state.net.client.clone();
        let res = async {
            let tokens = msa::refresh_msa(&client, &client_id, &refresh_token).await?;
            // Neues Refresh-Token sofort sichern (das alte wird ungültig)
            if let Some(rt) = &tokens.refresh_token {
                let mut s = self.load_secrets(id);
                s.msa_refresh_token = Some(rt.clone());
                self.store_secrets(id, &s);
            }
            let mc = msa::minecraft_login(&client, &tokens.access_token).await?;
            Ok::<_, AppError>((tokens, mc))
        }
        .await;
        match res {
            Ok((tokens, mc)) => {
                if mc.profile.id.to_lowercase() != id {
                    self.mark_relogin(id);
                    return Err(AppError::Auth("Das Microsoft-Konto gehört zu einem anderen Minecraft-Profil – bitte neu anmelden.".into()));
                }
                self.apply_login(&mc, tokens.refresh_token)?;
                tracing::info!("Microsoft-Account {} erneuert", mc.profile.name);
                self.get(id)
            }
            Err(e @ (AppError::Auth(_) | AppError::NotConfigured(_))) => {
                tracing::warn!("Erneuern von {} fehlgeschlagen: {e}", acc.username);
                self.mark_relogin(id);
                let inner = match e {
                    AppError::Auth(m) | AppError::NotConfigured(m) => m,
                    _ => unreachable!(),
                };
                let base = format!("Die Anmeldung von {} ist abgelaufen – bitte unter Accounts neu mit Microsoft anmelden.", acc.username);
                Err(AppError::Auth(if inner.contains("neu anmelden") { base } else { format!("{base} ({inner})") }))
            }
            Err(e) => {
                // Netzwerk o. ä.: nicht als "neu anmelden" markieren
                tracing::warn!("Erneuern von {} fehlgeschlagen: {e}", acc.username);
                Err(e)
            }
        }
    }

    /// Account-ID + gültiger Minecraft-Token für Profil-Änderungen (Skins/Capes). Frischt bei Bedarf auf.
    pub async fn mc_session(&self, state: &crate::state::AppState, account_id: Option<&str>) -> AppResult<(String, String)> {
        let explicit = account_id.filter(|s| !s.is_empty()).map(str::to_string);
        let active = self.store.lock().active.clone();
        let id = explicit
            .or(active)
            .ok_or_else(|| AppError::NotConfigured("Kein Account – bitte unter Accounts mit Microsoft anmelden".into()))?;
        let la = self.launch_account(state, Some(&id)).await?;
        Ok((id, la.access_token))
    }

    /// Nach Skin-Änderungen: Skin-URL im Account aktualisieren (-> `accounts://changed`).
    pub fn set_skin_url(&self, id: &str, url: Option<String>) {
        let changed = {
            let mut s = self.store.lock();
            match s.accounts.iter_mut().find(|a| a.id == id) {
                Some(a) if a.skin_url != url => {
                    a.skin_url = url;
                    true
                }
                _ => false,
            }
        };
        if changed {
            let _ = self.persist();
        }
    }

    /// Gültige Zugangsdaten für den Start (frischt Microsoft-Tokens bei Bedarf auf).
    /// `account_id = None` -> aktiver Account. Kein Account -> Fehler `NotConfigured`.
    pub async fn launch_account(&self, state: &crate::state::AppState, account_id: Option<&str>) -> AppResult<LaunchAccount> {
        let explicit = account_id.filter(|s| !s.is_empty()).map(str::to_string);
        let active = self.store.lock().active.clone();
        let Some(id) = explicit.or(active) else {
            #[cfg(debug_assertions)]
            if let Some(acc) = dev_offline_account() {
                return Ok(acc);
            }
            return Err(AppError::NotConfigured("Kein Account – bitte unter Accounts mit Microsoft anmelden".into()));
        };
        let acc = self.store.lock().accounts.iter().find(|a| a.id == id).cloned().ok_or_else(|| AppError::NotFound("Account".into()))?;
        let uuid = acc.uuid.replace('-', "");

        let secrets = self.load_secrets(&id);
        let expires = acc.expires_at.unwrap_or(0);
        let needs_refresh = acc.needs_relogin || secrets.mc_access_token.is_none() || expires - now_ms() < REFRESH_MARGIN_MS;
        let (acc, token) = if needs_refresh {
            match self.refresh(state, &id, false).await {
                Ok(_) => {
                    let acc = self.store.lock().accounts.iter().find(|a| a.id == id).cloned().ok_or_else(|| AppError::NotFound("Account".into()))?;
                    let token = self.load_secrets(&id).mc_access_token.ok_or_else(|| AppError::Auth("Kein Minecraft-Token".into()))?;
                    (acc, token)
                }
                // Netzwerkproblem, Token aber noch gültig -> damit starten
                Err(e) if !matches!(e, AppError::Auth(_)) && expires - now_ms() > 30_000 && secrets.mc_access_token.is_some() => {
                    tracing::warn!("Token-Erneuerung fehlgeschlagen, nutze vorhandenen Token: {e}");
                    (acc, secrets.mc_access_token.unwrap_or_default())
                }
                Err(e) => return Err(e),
            }
        } else {
            (acc, secrets.mc_access_token.unwrap_or_default())
        };
        Ok(LaunchAccount {
            username: acc.username,
            uuid,
            access_token: token,
            user_type: "msa".into(),
            xuid: acc.xuid,
            client_id: state.settings().msa_client(),
        })
    }
}

fn to_public(a: &StoredAccount, active: Option<&str>) -> Account {
    Account {
        id: a.id.clone(),
        kind: a.kind,
        username: a.username.clone(),
        uuid: a.uuid.clone(),
        skin_url: a.skin_url.clone(),
        active: active == Some(a.id.as_str()),
        expires_at: a.expires_at,
        needs_relogin: a.needs_relogin,
    }
}

fn msa_client_id(state: &crate::state::AppState) -> AppResult<String> {
    state.settings().msa_client().ok_or_else(|| {
        AppError::NotConfigured(
            "Microsoft-Login ist in diesem Build nicht eingerichtet (keine Azure-Client-ID). \
             Bitte eine Version von der offiziellen Release-Seite verwenden oder unter Einstellungen eine eigene Client-ID eintragen."
                .into(),
        )
    })
}

// ------------------------------------------------------------------ Nur Debug-Builds: Offline-Profil für Tests
//
// Der Launcher kennt keine Offline-Accounts. Für automatisierte Tests (Spielstart ohne Microsoft-Konto)
// liefert `launch_account` in Debug-Builds ein Offline-Profil, wenn `VIBE_DEV_OFFLINE_ACCOUNT=<Name>`
// gesetzt ist und kein Account übergeben/aktiv ist. Im Release-Build wird das komplett wegkompiliert.

#[cfg(debug_assertions)]
fn dev_offline_account() -> Option<LaunchAccount> {
    let name = std::env::var("VIBE_DEV_OFFLINE_ACCOUNT").ok()?;
    let name = name.trim();
    if !valid_offline_name(name) {
        tracing::warn!("VIBE_DEV_OFFLINE_ACCOUNT ignoriert: ungültiger Name (erlaubt: A-Z, 0-9, _, 3-16 Zeichen)");
        return None;
    }
    tracing::warn!("Debug: Spielstart mit Offline-Profil {name} (VIBE_DEV_OFFLINE_ACCOUNT)");
    Some(LaunchAccount {
        username: name.to_string(),
        uuid: offline_uuid(name).simple().to_string(),
        access_token: "0".into(),
        user_type: "legacy".into(),
        xuid: None,
        client_id: None,
    })
}

/// Offline-Name wie in Vanilla: `^[A-Za-z0-9_]{3,16}$`.
#[cfg(debug_assertions)]
fn valid_offline_name(name: &str) -> bool {
    (3..=16).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// UUID wie Vanilla für Offline-Spieler: `UUID.nameUUIDFromBytes("OfflinePlayer:" + name)` (v3, MD5 ohne Namespace).
#[cfg(debug_assertions)]
fn offline_uuid(name: &str) -> uuid::Uuid {
    use md5::{Digest, Md5};
    let hash: [u8; 16] = Md5::digest(format!("OfflinePlayer:{name}").as_bytes()).into();
    uuid::Builder::from_md5_bytes(hash).into_uuid()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lenient_accounts_file() {
        let json = r#"{"active":"a","accounts":[
            {"id":"a","kind":"microsoft","username":"Steve","uuid":"u"},
            {"id":"b","kind":"offline","username":"Alt","uuid":"v"},
            {"kaputt":true}
        ]}"#;
        let f: AccountsFile = serde_json::from_str(json).unwrap();
        assert_eq!(f.accounts.len(), 1);
        assert_eq!(f.accounts[0].username, "Steve");
    }

    #[cfg(debug_assertions)]
    #[test]
    fn offline_uuids() {
        assert_eq!(offline_uuid("Notch").hyphenated().to_string(), "b50ad385-829d-3141-a216-7e7d7539ba7f");
        assert_eq!(offline_uuid("Notch").simple().to_string(), "b50ad385829d3141a2167e7d7539ba7f");
        assert_eq!(offline_uuid("Notch").get_version_num(), 3);
        // Groß-/Kleinschreibung zählt (wie Vanilla)
        assert_ne!(offline_uuid("notch"), offline_uuid("Notch"));
    }

    #[cfg(debug_assertions)]
    #[test]
    fn dev_offline() {
        std::env::set_var("VIBE_DEV_OFFLINE_ACCOUNT", "Notch");
        let a = dev_offline_account().unwrap();
        assert_eq!((a.username.as_str(), a.uuid.as_str()), ("Notch", "b50ad385829d3141a2167e7d7539ba7f"));
        assert_eq!((a.user_type.as_str(), a.access_token.as_str()), ("legacy", "0"));
        std::env::set_var("VIBE_DEV_OFFLINE_ACCOUNT", "ungültig!");
        assert!(dev_offline_account().is_none());
        std::env::remove_var("VIBE_DEV_OFFLINE_ACCOUNT");
        assert!(dev_offline_account().is_none());
    }

    #[cfg(debug_assertions)]
    #[test]
    fn offline_names() {
        for ok in ["abc", "Notch", "jeb_", "A_1_b_2_c_3_d_4_", "___"] {
            assert!(valid_offline_name(ok), "{ok}");
        }
        for bad in ["", "ab", "abcdefghijklmnopq", "mit leer", "Ümlaut", "a-b", "name!", "Tést"] {
            assert!(!valid_offline_name(bad), "{bad}");
        }
    }

    #[test]
    fn accounts_file_has_no_secrets() {
        let f = AccountsFile {
            active: Some("x".into()),
            accounts: vec![StoredAccount {
                id: "x".into(),
                kind: AccountKind::Microsoft,
                username: "Steve".into(),
                uuid: "u".into(),
                skin_url: None,
                expires_at: Some(1),
                needs_relogin: false,
                xuid: Some("1".into()),
                added_at: 0,
            }],
        };
        let json = serde_json::to_string(&f).unwrap();
        assert!(!json.contains("token"));
    }
}
