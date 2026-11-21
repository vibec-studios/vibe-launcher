use super::*;

pub(super) fn to_public(a: &StoredAccount, active: Option<&str>) -> Account {
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

pub(super) fn msa_client_id(state: &crate::state::AppState) -> AppResult<String> {
    state.settings().msa_client().ok_or_else(|| {
        AppError::NotConfigured(
            "Microsoft-Login ist in diesem Build nicht eingerichtet (keine Azure-Client-ID). \
             Bitte eine Version von der offiziellen Release-Seite verwenden oder unter Einstellungen eine eigene Client-ID eintragen."
                .into(),
        )
    })
}

//
// Der Launcher kennt keine Offline-Accounts. Für automatisierte Tests (Spielstart ohne Microsoft-Konto)
// liefert `launch_account` in Debug-Builds ein Offline-Profil, wenn `VIBE_DEV_OFFLINE_ACCOUNT=<Name>`
// gesetzt ist und kein Account übergeben/aktiv ist. Im Release-Build wird das komplett wegkompiliert.

#[cfg(debug_assertions)]
pub(super) fn dev_offline_account() -> Option<LaunchAccount> {
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
pub(super) fn valid_offline_name(name: &str) -> bool {
    (3..=16).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// UUID wie Vanilla für Offline-Spieler: `UUID.nameUUIDFromBytes("OfflinePlayer:" + name)` (v3, MD5 ohne Namespace).
#[cfg(debug_assertions)]
pub(super) fn offline_uuid(name: &str) -> uuid::Uuid {
    use md5::{Digest, Md5};
    let hash: [u8; 16] = Md5::digest(format!("OfflinePlayer:{name}").as_bytes()).into();
    uuid::Builder::from_md5_bytes(hash).into_uuid()
}
