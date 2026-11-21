use super::*;

#[derive(Debug, Clone, Serialize)]
pub struct JoinResult {
    /// Minecraft-Name für `/auth/verify`
    pub name: String,
    pub uuid: String,
}

/// Mojang `session/minecraft/join` mit dem Minecraft-Token des aktiven Accounts (bleibt in Rust).
pub async fn mojang_join(state: &AppState, server_id: &str) -> AppResult<JoinResult> {
    ensure(state, Feature::Any)?;
    if server_id.is_empty() || server_id.len() > 64 || !server_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err(AppError::Invalid("Ungültige Anmeldeanfrage".into()));
    }
    let la = state.auth.online_account(state, None).await?;
    let name = la.username.clone();
    let uuid = dashed(&la.uuid);
    // Debug-Offline-Profil: kein echter Token, das lokale Test-Backend (AUTH_DEV_BYPASS) prüft nicht
    #[cfg(debug_assertions)]
    if la.user_type == "legacy" {
        // Nie gegen das echte Backend: dort gibt es keinen Dev-Bypass
        if debug_override("VIBE_API_URL").is_none() {
            return Err(AppError::Auth("Das Offline-Testprofil kann sich nur an einem lokalen Test-Backend (VIBE_API_URL) anmelden.".into()));
        }
        return Ok(JoinResult { name, uuid });
    }
    let send = |token: String| {
        let body = serde_json::json!({ "accessToken": token, "selectedProfile": la.uuid.replace('-', ""), "serverId": server_id });
        let client = state.net.client.clone();
        async move { client.post("https://sessionserver.mojang.com/session/minecraft/join").json(&body).timeout(Duration::from_secs(15)).send().await }
    };
    let r = send(la.access_token.clone()).await?;
    if r.status().is_success() {
        return Ok(JoinResult { name, uuid });
    }
    // Token abgelehnt -> einmal erneuern und wiederholen
    if r.status().as_u16() == 401 || r.status().as_u16() == 403 {
        let id = state.auth.list().into_iter().find(|a| a.active).map(|a| a.id);
        if let Some(id) = id {
            state.auth.refresh(state, &id, true).await?;
            let la2 = state.auth.online_account(state, Some(&id)).await?;
            let r2 = send(la2.access_token).await?;
            if r2.status().is_success() {
                return Ok(JoinResult { name, uuid });
            }
            return Err(AppError::Auth(format!("Mojang hat die Anmeldung abgelehnt (HTTP {}). Melde dich unter „Accounts“ neu an.", r2.status().as_u16())));
        }
    }
    Err(AppError::Auth(format!("Mojang hat die Anmeldung abgelehnt (HTTP {}).", r.status().as_u16())))
}

pub(super) fn dashed(u: &str) -> String {
    let h = u.replace('-', "").to_lowercase();
    if h.len() != 32 {
        return u.to_string();
    }
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}
