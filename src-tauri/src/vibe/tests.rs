use super::*;

#[test]
fn api_url_check() {
    let base = "https://vibe.axolite.app";
    assert!(check_api_url(base, "https://vibe.axolite.app/api/v1/meta").is_ok());
    assert!(check_api_url(base, "https://vibe.axolite.app:443/api/v1/friends?x=1").is_ok());
    assert!(check_api_url(base, "https://evil.example/api/v1/meta").is_err());
    assert!(check_api_url(base, "http://vibe.axolite.app/api/v1/meta").is_err());
    assert!(check_api_url(base, "https://vibe.axolite.app/admin/api/users").is_err());
    assert!(check_api_url(base, "https://vibe.axolite.app.evil.example/api/v1").is_err());
    // Alte Adresse = dasselbe Backend (Downloads aus Antworten mit der alten Adresse)
    assert!(check_api_url(base, "https://vibe.henny.dev/api/v1/client/files/a/b.jar").is_ok());
    assert!(check_api_url(base, "https://VIBE.HENNY.DEV/api/v1/meta").is_ok());
    assert!(check_api_url(base, "http://vibe.henny.dev/api/v1/meta").is_err());
    assert!(check_api_url(base, "https://vibe.henny.dev/admin/api/users").is_err());
    assert!(check_api_url(base, "https://vibe.henny.dev.evil.example/api/v1").is_err());
    assert!(check_api_url(base, "https://axolite.app/api/v1/meta").is_err());
    assert!(check_api_url(base, "https://api.axolite.app/api/v1/meta").is_err());
    assert!(check_api_url("https://vibe.henny.dev", "https://vibe.axolite.app/api/v1/meta").is_ok());
    let local = "http://127.0.0.1:3917";
    assert!(check_api_url(local, "http://127.0.0.1:3917/api/v1/packs/ABC/versions/1/overrides.zip").is_ok());
    assert!(check_api_url(local, "http://127.0.0.1:3000/api/v1/meta").is_err());
    // Lokales Backend: die offiziellen Hosts gelten dort nicht
    assert!(check_api_url(local, "https://vibe.axolite.app/api/v1/meta").is_err());
}

#[test]
fn api_url_is_fixed() {
    assert_eq!(effective_api_url(None), DEFAULT_API_URL);
    assert_eq!(DEFAULT_API_URL, "https://vibe.axolite.app");
    assert_eq!(effective_api_url(Some("http://127.0.0.1:3000".into())), "http://127.0.0.1:3000");
    // Alte Standardadresse -> neue
    assert_eq!(effective_api_url(Some("https://vibe.henny.dev".into())), DEFAULT_API_URL);
    // Release-Builds lesen keine Env-Variablen
    #[cfg(not(debug_assertions))]
    {
        std::env::set_var("VIBE_API_URL", "https://evil.example");
        assert!(debug_override("VIBE_API_URL").is_none());
    }
}

#[test]
fn stored_tokens_follow_domain_move() {
    let new = DEFAULT_API_URL;
    assert_eq!(token_match("https://vibe.axolite.app", new), Some(TokenMatch::Same));
    assert_eq!(token_match("https://vibe.axolite.app/", new), Some(TokenMatch::Same));
    // Alte Standardadresse -> einmalig umstellen statt abmelden
    assert_eq!(token_match("https://vibe.henny.dev", new), Some(TokenMatch::Migrate));
    assert_eq!(token_match("https://vibe.henny.dev/", new), Some(TokenMatch::Migrate));
    // Eigene/andere Adressen bleiben getrennt
    assert_eq!(token_match("http://127.0.0.1:3917", new), None);
    assert_eq!(token_match("https://evil.example", new), None);
    assert_eq!(token_match("https://vibe.axolite.app", "http://127.0.0.1:3917"), None);
    assert_eq!(token_match("https://vibe.henny.dev", "http://127.0.0.1:3917"), None);
    assert_eq!(token_match("http://127.0.0.1:3917", "http://127.0.0.1:3917"), Some(TokenMatch::Same));
}

#[test]
fn dashes() {
    assert_eq!(dashed("069a79f444e94726a5befca90e38aaf5"), "069a79f4-44e9-4726-a5be-fca90e38aaf5");
    assert_eq!(dashed("069a79f4-44e9-4726-a5be-fca90e38aaf5"), "069a79f4-44e9-4726-a5be-fca90e38aaf5");
}

#[test]
fn error_text() {
    let e = api_error(429, r#"{"error":{"code":"rate_limited","message":"Zu schnell"}}"#);
    assert_eq!(e.to_string(), "Zu schnell");
    assert!(matches!(api_error(401, "{}"), AppError::Auth(_)));
}

#[test]
fn access_errors() {
    for code in ["ACCESS_PENDING", "ACCESS_REJECTED", "ACCESS_NONE"] {
        let e = api_error(403, &format!(r#"{{"error":{{"code":"{code}","message":"locked"}}}}"#));
        assert!(matches!(e, AppError::Access(_)), "{code}");
        assert_eq!(e.kind(), "access");
        assert!(e.to_string().starts_with("Vibe ist in der Beta"));
    }
    let other = api_error(403, r#"{"error":{"code":"forbidden","message":"Nein"}}"#);
    assert!(matches!(other, AppError::Msg(_)));
    assert_eq!(other.to_string(), "Nein");
    assert!(matches!(api_error(429, r#"{"error":{"code":"ACCESS_NONE"}}"#), AppError::Msg(_)));
    assert!(access_text("access_none").is_none());
}
