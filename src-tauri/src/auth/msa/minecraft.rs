use super::*;

#[derive(Deserialize)]
pub(super) struct McLoginResponse {
    pub(super) access_token: String,
    #[serde(default = "default_mc_expires")]
    pub(super) expires_in: u64,
}
pub(super) fn default_mc_expires() -> u64 {
    86400
}

#[derive(Deserialize)]
pub(super) struct Entitlements {
    #[serde(default)]
    pub(super) items: Vec<Value>,
}

#[derive(Deserialize)]
pub(super) struct ProfileResponse {
    pub(super) id: String,
    pub(super) name: String,
    #[serde(default)]
    pub(super) skins: Vec<ProfileSkin>,
}
#[derive(Deserialize)]
pub(super) struct ProfileSkin {
    #[serde(default)]
    pub(super) state: String,
    #[serde(default)]
    pub(super) url: String,
}

/// Komplette Kette ab MSA-Access-Token.
pub async fn minecraft_login(client: &reqwest::Client, msa_access_token: &str) -> AppResult<McLogin> {
    let (xbl, _) = xbox_live(client, msa_access_token).await?;
    let (xsts_token, uhs) = xsts(client, &xbl).await?;

    let (status, bytes) =
        post_json(client, MC_LOGIN, &json!({ "identityToken": format!("XBL3.0 x={uhs};{xsts_token}") }), None).await?;
    match status {
        200..=299 => {}
        403 => {
            return Err(AppError::NotConfigured(
                "Minecraft hat die Anmeldung abgelehnt: Die Azure-App ist (noch) nicht für die Minecraft-API freigeschaltet. \
                 Neue Client-IDs müssen über das Formular von Mojang freigegeben werden (https://aka.ms/mce-reviewappid)."
                    .into(),
            ))
        }
        429 => return Err(AppError::msg("Zu viele Anmeldeversuche bei Minecraft – bitte ein paar Minuten warten.")),
        s if s >= 500 => return Err(AppError::Unreachable(format!("Minecraft-Dienste nicht erreichbar (HTTP {s}) – bitte später erneut versuchen"))),
        s => return Err(AppError::Auth(format!("Minecraft-Anmeldung fehlgeschlagen (HTTP {s})"))),
    }
    let login: McLoginResponse =
        serde_json::from_slice(&bytes).map_err(|e| AppError::msg(format!("Ungültige Antwort von Minecraft: {e}")))?;

    let owns_game = match client.get(MC_ENTITLEMENTS).bearer_auth(&login.access_token).send().await {
        Ok(r) if r.status().is_success() => r.json::<Entitlements>().await.map(|e| !e.items.is_empty()).unwrap_or(true),
        _ => true, // Nicht entscheidbar -> Profil entscheidet
    };

    let profile = fetch_profile(client, &login.access_token, owns_game).await?;
    Ok(McLogin { xuid: jwt_claim(&login.access_token, "xuid"), access_token: login.access_token, expires_in: login.expires_in, profile })
}

pub async fn fetch_profile(client: &reqwest::Client, mc_token: &str, owns_game: bool) -> AppResult<McProfile> {
    let resp = client.get(MC_PROFILE).bearer_auth(mc_token).send().await?;
    let status = resp.status().as_u16();
    match status {
        200..=299 => {}
        404 => {
            return Err(AppError::Auth(if owns_game {
                "Kein Minecraft: Java Edition-Profil – für dieses Konto wurde noch kein Spielername festgelegt. \
                 Bitte einmal auf minecraft.net anmelden und einen Namen wählen."
                    .into()
            } else {
                "Kein Minecraft: Java Edition-Profil – dieses Microsoft-Konto besitzt Minecraft: Java Edition nicht \
                 (Xbox Game Pass: einmal den offiziellen Launcher starten)."
                    .into()
            }))
        }
        401 => return Err(AppError::Auth("Minecraft-Token ungültig".into())),
        s if s >= 500 => return Err(AppError::Unreachable(format!("Minecraft-Profil konnte nicht geladen werden (HTTP {s})"))),
        s => return Err(AppError::msg(format!("Minecraft-Profil konnte nicht geladen werden (HTTP {s})"))),
    }
    let p: ProfileResponse = resp.json().await.map_err(|e| AppError::msg(format!("Ungültiges Minecraft-Profil: {e}")))?;
    let skin_url = p
        .skins
        .iter()
        .find(|s| s.state.eq_ignore_ascii_case("active"))
        .or(p.skins.first())
        .map(|s| s.url.clone())
        .filter(|u| !u.is_empty());
    Ok(McProfile { id: p.id.replace('-', ""), name: p.name, skin_url })
}

/// Claim aus dem (unverifizierten) Payload eines JWT lesen.
pub fn jwt_claim(token: &str, claim: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    match &v[claim] {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}
