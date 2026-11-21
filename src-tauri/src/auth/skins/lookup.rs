use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerSkin {
    pub name: String,
    pub url: String,
    pub variant: SkinVariant,
}

/// `textures`-Property des Session-Profils (Base64-JSON) auswerten.
pub fn parse_textures_property(value_b64: &str) -> Option<(String, SkinVariant)> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(value_b64.trim()).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    let skin = &v["textures"]["SKIN"];
    let url = skin["url"].as_str()?.to_string();
    let variant = SkinVariant::from_api(skin["metadata"]["model"].as_str().unwrap_or("classic"));
    Some((url, variant))
}

pub async fn lookup_player(client: &reqwest::Client, name: &str) -> AppResult<PlayerSkin> {
    let name = name.trim();
    if !valid_player_name(name) {
        return Err(AppError::Invalid("Ungültiger Spielername (nur A–Z, 0–9 und _, höchstens 16 Zeichen).".into()));
    }
    let not_found = || AppError::NotFound(format!("Spieler „{name}“"));
    // Name -> UUID (api.mojang.com, Ersatz: Minecraft-Services-Lookup)
    let mut found: Option<(String, String)> = None;
    for url in [
        format!("https://api.mojang.com/users/profiles/minecraft/{name}"),
        format!("https://api.minecraftservices.com/minecraft/profile/lookup/name/{name}"),
    ] {
        let resp = client.get(&url).send().await?;
        let status = resp.status().as_u16();
        match status {
            200 => {
                let v: Value = resp.json().await.map_err(|e| AppError::msg(format!("Ungültige Antwort von Mojang: {e}")))?;
                if let (Some(id), Some(n)) = (v["id"].as_str(), v["name"].as_str()) {
                    found = Some((id.to_string(), n.to_string()));
                    break;
                }
            }
            204 | 404 => return Err(not_found()),
            429 => return Err(AppError::msg("Zu viele Anfragen an Mojang – bitte kurz warten.")),
            _ => continue,
        }
    }
    let (uuid, real_name) = found.ok_or_else(|| AppError::msg("Mojang-Dienst nicht erreichbar – bitte später erneut versuchen."))?;

    let resp = client.get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{uuid}")).send().await?;
    match resp.status().as_u16() {
        200 => {}
        204 | 404 => return Err(not_found()),
        429 => return Err(AppError::msg("Zu viele Anfragen an Mojang – bitte kurz warten.")),
        s => return Err(AppError::msg(format!("Mojang-Sessionserver nicht erreichbar (HTTP {s})"))),
    }
    let v: Value = resp.json().await.map_err(|e| AppError::msg(format!("Ungültige Antwort von Mojang: {e}")))?;
    let prop = v["properties"]
        .as_array()
        .and_then(|a| a.iter().find(|p| p["name"] == "textures"))
        .and_then(|p| p["value"].as_str())
        .ok_or_else(|| AppError::msg("Mojang lieferte keine Texturen"))?;
    let (url, variant) =
        parse_textures_property(prop).ok_or_else(|| AppError::Invalid(format!("{real_name} nutzt den Standard-Skin (kein eigener Skin).")))?;
    Ok(PlayerSkin { name: real_name, url, variant })
}
