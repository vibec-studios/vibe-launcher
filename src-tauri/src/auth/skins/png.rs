use super::*;

/// Breite/Höhe aus dem PNG-Header (IHDR).
pub fn png_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    const SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if b.len() < 24 || b[..8] != SIG || &b[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes(b[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(b[20..24].try_into().ok()?);
    Some((w, h))
}

/// Prüft, ob die Datei ein von Minecraft akzeptierter Skin ist (PNG 64×64 oder 64×32).
pub fn validate_skin_png(b: &[u8]) -> AppResult<()> {
    if b.len() > MAX_PNG {
        return Err(AppError::Invalid("Die Skin-Datei ist zu groß (max. 512 KB).".into()));
    }
    match png_dimensions(b) {
        None => Err(AppError::Invalid("Das ist keine PNG-Datei.".into())),
        Some((64, 64)) | Some((64, 32)) => Ok(()),
        Some((w, h)) => Err(AppError::Invalid(format!("Skins müssen 64×64 oder 64×32 Pixel groß sein (diese Datei: {w}×{h})."))),
    }
}

pub fn data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

pub fn decode_png_payload(payload: &str) -> AppResult<Vec<u8>> {
    let s = payload.trim();
    let b64 = match s.strip_prefix("data:") {
        Some(rest) => rest.split_once(',').filter(|(head, _)| head.ends_with(";base64")).map(|(_, b)| b).ok_or_else(|| AppError::Invalid("Ungültige Bilddaten.".into()))?,
        None => s,
    };
    if b64.len() > MAX_PNG * 4 / 3 + 8 {
        return Err(AppError::Invalid("Die Skin-Datei ist zu groß (max. 512 KB).".into()));
    }
    let png = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| AppError::Invalid("Ungültige Bilddaten.".into()))?;
    validate_skin_png(&png)?;
    Ok(png)
}

/// Minecraft-Spielername (inkl. alter, kurzer Namen).
pub fn valid_player_name(n: &str) -> bool {
    (1..=16).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Fehlerantworten der Minecraft-Services in verständliche Meldungen übersetzen.
pub fn services_error(status: u16, body: &[u8]) -> AppError {
    let v: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let detail = v["errorMessage"].as_str().or(v["details"]["reason"].as_str()).or(v["error"].as_str()).unwrap_or("").to_string();
    match status {
        429 => AppError::msg("Zu viele Skin-Änderungen – bitte kurz warten (etwa eine Minute) und erneut versuchen."),
        401 => AppError::Auth("Die Minecraft-Anmeldung ist abgelaufen – bitte den Account unter Accounts auffrischen.".into()),
        403 => AppError::msg("Minecraft erlaubt diese Änderung für diesen Account nicht."),
        404 => AppError::NotFound("Skin bzw. Cape (bei Minecraft nicht vorhanden)".into()),
        400 if !detail.is_empty() => AppError::Invalid(format!("Minecraft hat die Änderung abgelehnt: {detail}")),
        400 => AppError::Invalid("Minecraft hat die Skin-Datei abgelehnt (ungültiges Format?).".into()),
        s if s >= 500 => AppError::msg(format!("Minecraft-Dienste nicht erreichbar (HTTP {s}) – bitte später erneut versuchen.")),
        s => AppError::msg(format!("Skin-Änderung fehlgeschlagen (HTTP {s})")),
    }
}

pub(super) async fn read_profile_response(resp: reqwest::Response) -> AppResult<RawProfile> {
    let status = resp.status().as_u16();
    let body = resp.bytes().await?;
    if !(200..300).contains(&status) {
        return Err(services_error(status, &body));
    }
    serde_json::from_slice(&body).map_err(|e| AppError::msg(format!("Ungültiges Minecraft-Profil: {e}")))
}
