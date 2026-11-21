use super::*;

pub async fn fetch_profile(client: &reqwest::Client, token: &str) -> AppResult<RawProfile> {
    read_profile_response(client.get(PROFILE).bearer_auth(token).send().await?).await
}

pub async fn upload_skin(client: &reqwest::Client, token: &str, variant: SkinVariant, png: Vec<u8>) -> AppResult<RawProfile> {
    validate_skin_png(&png)?;
    let part = reqwest::multipart::Part::bytes(png).file_name("skin.png").mime_str("image/png").map_err(|e| AppError::msg(e.to_string()))?;
    let form = reqwest::multipart::Form::new().text("variant", variant.api()).part("file", part);
    read_profile_response(client.post(format!("{PROFILE}/skins")).bearer_auth(token).multipart(form).send().await?).await
}

pub async fn reset_skin(client: &reqwest::Client, token: &str) -> AppResult<RawProfile> {
    read_profile_response(client.delete(format!("{PROFILE}/skins/active")).bearer_auth(token).send().await?).await
}

pub async fn set_cape(client: &reqwest::Client, token: &str, cape_id: Option<&str>) -> AppResult<RawProfile> {
    let req = match cape_id {
        Some(id) => client.put(format!("{PROFILE}/capes/active")).json(&json!({ "capeId": id })),
        None => client.delete(format!("{PROFILE}/capes/active")),
    };
    read_profile_response(req.bearer_auth(token).send().await?).await
}

/// Textur laden (mit Datei-Cache – Textur-URLs sind inhaltsadressiert und ändern sich nie).
pub async fn fetch_texture(client: &reqwest::Client, cache_dir: &Path, url: &str) -> AppResult<Vec<u8>> {
    let url = url.replacen("http://textures.minecraft.net", "https://textures.minecraft.net", 1);
    let key = hex::encode(Sha1::digest(url.as_bytes()));
    let path = cache_dir.join(format!("{key}.png"));
    if let Ok(b) = tokio::fs::read(&path).await {
        if png_dimensions(&b).is_some() {
            return Ok(b);
        }
    }
    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("Textur konnte nicht geladen werden (HTTP {})", resp.status())));
    }
    let b = resp.bytes().await?.to_vec();
    if b.len() > MAX_PNG || png_dimensions(&b).is_none() {
        return Err(AppError::msg("Textur ist kein gültiges PNG"));
    }
    let _ = tokio::fs::create_dir_all(cache_dir).await;
    let _ = tokio::fs::write(&path, &b).await;
    Ok(b)
}

pub async fn build_profile(client: &reqwest::Client, cache_dir: &Path, account_id: &str, raw: &RawProfile) -> SkinProfile {
    let skin = match raw.active_skin() {
        Some(s) if !s.url.is_empty() => Some(ActiveSkin {
            id: s.id.clone(),
            url: s.url.clone(),
            variant: SkinVariant::from_api(s.variant.as_deref().unwrap_or("classic")),
            data_url: fetch_texture(client, cache_dir, &s.url).await.ok().map(|b| data_url(&b)),
        }),
        _ => None,
    };
    let caps = futures::future::join_all(raw.capes.iter().map(|c| async move {
        Cape {
            id: c.id.clone(),
            alias: c.alias.clone().unwrap_or_else(|| "Cape".into()),
            url: c.url.clone(),
            state: c.state.to_ascii_uppercase(),
            data_url: fetch_texture(client, cache_dir, &c.url).await.ok().map(|b| data_url(&b)),
        }
    }))
    .await;
    SkinProfile { account_id: account_id.to_string(), username: raw.name.clone(), skin, capes: caps }
}
