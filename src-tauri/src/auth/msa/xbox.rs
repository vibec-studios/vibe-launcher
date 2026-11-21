use super::*;

pub(super) async fn post_json(client: &reqwest::Client, url: &str, body: &Value, bearer: Option<&str>) -> AppResult<(u16, bytes::Bytes)> {
    let mut req = client.post(url).header("Accept", "application/json").json(body);
    if let Some(t) = bearer {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await?;
    let status = resp.status().as_u16();
    Ok((status, resp.bytes().await?))
}

#[derive(Deserialize)]
pub(super) struct XblResponse {
    #[serde(rename = "Token")]
    pub(super) token: String,
    #[serde(rename = "DisplayClaims")]
    pub(super) display_claims: XblClaims,
}
#[derive(Deserialize)]
pub(super) struct XblClaims {
    pub(super) xui: Vec<XblXui>,
}
#[derive(Deserialize)]
pub(super) struct XblXui {
    pub(super) uhs: String,
}

/// Xbox-Live-Token + User-Hash.
pub async fn xbox_live(client: &reqwest::Client, msa_access_token: &str) -> AppResult<(String, String)> {
    let body = json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={msa_access_token}"),
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT",
    });
    let (status, bytes) = post_json(client, XBL_AUTH, &body, None).await?;
    if !(200..300).contains(&status) {
        if status >= 500 {
            return Err(AppError::Unreachable(format!("Xbox Live nicht erreichbar (HTTP {status}) – bitte später erneut versuchen")));
        }
        return Err(AppError::Auth(format!("Xbox-Live-Anmeldung fehlgeschlagen (HTTP {status})")));
    }
    let r: XblResponse = serde_json::from_slice(&bytes).map_err(|e| AppError::msg(format!("Ungültige Antwort von Xbox Live: {e}")))?;
    let uhs = r.display_claims.xui.into_iter().next().map(|x| x.uhs).ok_or_else(|| AppError::msg("Xbox Live lieferte keinen User-Hash"))?;
    Ok((r.token, uhs))
}

/// XSTS-Token für Minecraft. Liefert (Token, User-Hash).
pub async fn xsts(client: &reqwest::Client, xbl_token: &str) -> AppResult<(String, String)> {
    let body = json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT",
    });
    let (status, bytes) = post_json(client, XSTS_AUTH, &body, None).await?;
    if status == 401 {
        return Err(AppError::Auth(xsts_error(&bytes)));
    }
    if !(200..300).contains(&status) {
        if status >= 500 {
            return Err(AppError::Unreachable(format!("Xbox-Dienst nicht erreichbar (HTTP {status}) – bitte später erneut versuchen")));
        }
        return Err(AppError::Auth(format!("Xbox-Autorisierung fehlgeschlagen (HTTP {status})")));
    }
    let r: XblResponse = serde_json::from_slice(&bytes).map_err(|e| AppError::msg(format!("Ungültige Antwort von XSTS: {e}")))?;
    let uhs = r.display_claims.xui.into_iter().next().map(|x| x.uhs).ok_or_else(|| AppError::msg("XSTS lieferte keinen User-Hash"))?;
    Ok((r.token, uhs))
}

/// XSTS-Fehlerantwort (`{"XErr": 2148916233, ...}`) -> deutsche Meldung.
pub fn xsts_error(body: &[u8]) -> String {
    let v: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let code = match &v["XErr"] {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    };
    match code {
        Some(c) => xsts_message(c),
        None => "Xbox-Autorisierung fehlgeschlagen".into(),
    }
}

pub fn xsts_message(code: u64) -> String {
    match code {
        2148916233 => "Zu diesem Microsoft-Konto gibt es noch kein Xbox-Profil. Melde dich einmal auf xbox.com (oder minecraft.net) an, \
                       um eines anzulegen, und versuche es dann erneut."
            .into(),
        2148916235 => "Xbox Live ist in deinem Land bzw. deiner Region nicht verfügbar.".into(),
        2148916236 | 2148916237 => "Für dieses Konto ist ein Altersnachweis nötig (Südkorea). Bitte auf xbox.com die Altersverifizierung abschließen.".into(),
        2148916238 => "Dies ist ein Kinderkonto. Ein Erwachsener muss es auf account.microsoft.com/family zu einer Microsoft-Familie hinzufügen, \
                       bevor Minecraft genutzt werden kann."
            .into(),
        2148916227 => "Dieses Konto wurde von Xbox gesperrt.".into(),
        2148916229 => "Online-Spielen ist für dieses Konto durch die Jugendschutzeinstellungen gesperrt.".into(),
        2148916234 => "Die Xbox-Nutzungsbedingungen wurden noch nicht akzeptiert. Bitte einmal auf xbox.com anmelden.".into(),
        c => format!("Xbox-Autorisierung fehlgeschlagen (Fehlercode {c})"),
    }
}
