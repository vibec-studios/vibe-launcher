use super::*;

pub const REDIRECT_HINT: &str = "Das Anmeldefenster ist in der Azure-App noch nicht freigeschaltet: Unter „Authentication → Mobile and desktop applications“ muss die Redirect URI https://login.microsoftonline.com/common/oauth2/nativeclient aktiviert sein. Bis dahin klappt die Anmeldung über „Im Browser anmelden (Code)“.";

pub fn redirect_uri_problem(error: &str, desc: &str) -> bool {
    let d = desc.to_ascii_lowercase();
    (error == "invalid_request" || error.is_empty()) && (d.contains("redirect_uri") || d.contains("redirect uri") || d.contains("reply address"))
}

/// OAuth-Fehler von login.microsoftonline.com in verständliche Meldungen übersetzen.
pub fn oauth_error(status: u16, body: &[u8]) -> AppError {
    let Ok(e) = serde_json::from_slice::<OAuthError>(body) else {
        return AppError::msg(format!("Microsoft-Anmeldung fehlgeschlagen (HTTP {status})"));
    };
    let desc = first_line(&e.error_description);
    let has = |code: u64| e.error_codes.contains(&code) || desc.contains(&format!("AADSTS{code}:"));
    if redirect_uri_problem(&e.error, desc) || has(50011) || has(500113) {
        return AppError::NotConfigured(REDIRECT_HINT.into());
    }
    match e.error.as_str() {
        "expired_token" => return AppError::Auth("Der Anmeldecode ist abgelaufen – bitte den Login erneut starten.".into()),
        "authorization_declined" | "access_denied" => return AppError::Auth("Die Anmeldung wurde im Browser abgelehnt.".into()),
        "bad_verification_code" => return AppError::Auth("Der Anmeldecode ist ungültig – bitte den Login erneut starten.".into()),
        "invalid_grant" => {
            return AppError::Auth("Die gespeicherte Microsoft-Anmeldung ist nicht mehr gültig – bitte neu anmelden.".into())
        }
        _ => {}
    }
    if has(700016) {
        return AppError::NotConfigured(
            "Die Microsoft-Client-ID ist unbekannt oder nicht für private Microsoft-Konten freigegeben (AADSTS700016). \
             Prüfe die Azure-App-Registrierung (Kontotyp „Personal Microsoft accounts“) bzw. die Client-ID in den Einstellungen."
                .into(),
        );
    }
    if has(7000218) || has(70002) {
        return AppError::NotConfigured(
            "Die Azure-App erlaubt keine öffentlichen Client-Flows. In der App-Registrierung unter „Authentication“ \
             „Allow public client flows“ auf „Yes“ stellen."
                .into(),
        );
    }
    if has(9002331) || has(50194) || has(9002346) {
        return AppError::NotConfigured(format!(
            "Die Azure-App ist nicht für private Microsoft-Konten eingerichtet ({desc}). Kontotyp „Personal Microsoft accounts“ wählen."
        ));
    }
    if has(700038) || has(900144) || e.error == "invalid_client" || e.error == "unauthorized_client" || (desc.contains("client") && e.error == "invalid_request") {
        return AppError::NotConfigured(format!("Die Microsoft-Client-ID ist ungültig: {desc}"));
    }
    let what = if e.error.is_empty() { format!("HTTP {status}") } else { e.error.clone() };
    if desc.is_empty() {
        AppError::Auth(format!("Microsoft-Anmeldung fehlgeschlagen ({what})"))
    } else {
        AppError::Auth(format!("Microsoft-Anmeldung fehlgeschlagen ({what}): {desc}"))
    }
}
