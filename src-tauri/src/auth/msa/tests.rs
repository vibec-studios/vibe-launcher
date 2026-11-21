use super::*;

#[test]
fn xsts_errors() {
    assert!(xsts_error(br#"{"Identity":"0","XErr":2148916233,"Message":"","Redirect":"https://start.ui.xboxlive.com/CreateAccount"}"#)
        .contains("kein Xbox-Profil"));
    assert!(xsts_error(br#"{"XErr":2148916235}"#).contains("Land"));
    assert!(xsts_error(br#"{"XErr":2148916236}"#).contains("Altersnachweis"));
    assert!(xsts_error(br#"{"XErr":2148916237}"#).contains("Altersnachweis"));
    assert!(xsts_error(br#"{"XErr":2148916238}"#).contains("Kinderkonto"));
    assert!(xsts_error(br#"{"XErr":"2148916238"}"#).contains("Kinderkonto"));
    assert!(xsts_error(br#"{"XErr":123}"#).contains("123"));
    assert_eq!(xsts_error(b"kaputt"), "Xbox-Autorisierung fehlgeschlagen");
}

#[test]
fn oauth_errors() {
    let unknown = br#"{"error":"unauthorized_client","error_description":"AADSTS700016: Application with identifier 'x' was not found in the directory 'Microsoft Accounts'.\r\nTrace ID: abc","error_codes":[700016]}"#;
    assert!(matches!(oauth_error(400, unknown), AppError::NotConfigured(m) if m.contains("AADSTS700016")));
    let public = br#"{"error":"invalid_client","error_description":"AADSTS7000218: The request body must contain ...","error_codes":[7000218]}"#;
    assert!(matches!(oauth_error(400, public), AppError::NotConfigured(m) if m.contains("public client")));
    assert!(matches!(oauth_error(400, br#"{"error":"expired_token"}"#), AppError::Auth(m) if m.contains("abgelaufen")));
    assert!(matches!(oauth_error(400, br#"{"error":"invalid_grant","error_description":"AADSTS70000: x"}"#), AppError::Auth(m) if m.contains("neu anmelden")));
    let invalid = br#"{"error":"invalid_request","error_description":"AADSTS700038: 0000 is not a valid application identifier. Trace ID: f5 Correlation ID: 0e Timestamp: 2026","error_codes":[700038]}"#;
    assert!(matches!(oauth_error(400, invalid), AppError::NotConfigured(m) if m.ends_with("application identifier.")));
    let other = br#"{"error":"temporarily_unavailable","error_description":"Bitte warten\r\nTrace ID: 1"}"#;
    match oauth_error(503, other) {
        AppError::Auth(m) => {
            assert!(m.contains("temporarily_unavailable"));
            assert!(!m.contains("Trace"));
        }
        e => panic!("{e:?}"),
    }
    assert!(matches!(oauth_error(502, b"<html>"), AppError::Msg(_)));
}

#[tokio::test]
async fn code_exchange_sends_verifier() {
    let srv = super::super::fake_server::serve(200, r#"{"access_token":"at","refresh_token":"rt"}"#).await;
    let t = exchange_code_at(&reqwest::Client::new(), &srv.url, "cid", "the-code", "the-verifier").await.unwrap();
    assert_eq!((t.access_token.as_str(), t.refresh_token.as_deref()), ("at", Some("rt")));
    let req = srv.requests.lock().concat();
    let raw_body = req.split("\r\n\r\n").nth(1).unwrap_or_default();
    let body: std::collections::HashMap<String, String> = url::form_urlencoded::parse(raw_body.as_bytes()).into_owned().collect();
    assert_eq!(body["grant_type"], "authorization_code");
    assert_eq!(body["code"], "the-code");
    assert_eq!(body["code_verifier"], "the-verifier");
    assert_eq!(body["redirect_uri"], crate::auth::pkce::REDIRECT_URI);
    assert_eq!(body["client_id"], "cid");
}

#[tokio::test]
async fn code_exchange_redirect_not_enabled() {
    let srv = super::super::fake_server::serve(
        400,
        r#"{"error":"invalid_request","error_description":"AADSTS50011: The redirect URI 'https://login.microsoftonline.com/common/oauth2/nativeclient' specified in the request does not match the redirect URIs configured for the application.","error_codes":[50011]}"#,
    )
    .await;
    let e = exchange_code_at(&reqwest::Client::new(), &srv.url, "cid", "c", "v").await.unwrap_err();
    assert!(matches!(e, AppError::NotConfigured(m) if m.contains("Mobile and desktop applications") && m.contains("(Code)")));
}

#[test]
fn redirect_uri_errors_point_to_fallback() {
    let live = br#"{"error":"invalid_request","error_description":"The provided value for the input parameter 'redirect_uri' is not valid. The expected value is a URI which matches a redirect URI registered for this client application."}"#;
    assert!(matches!(oauth_error(400, live), AppError::NotConfigured(m) if m == REDIRECT_HINT));
    assert!(!redirect_uri_problem("invalid_grant", "redirect_uri"));
}

#[test]
fn jwt_xuid() {
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"xuid":"2535400000000000","sub":"x"}"#);
    let token = format!("eyJhbGciOiJIUzI1NiJ9.{payload}.sig");
    assert_eq!(jwt_claim(&token, "xuid").as_deref(), Some("2535400000000000"));
    assert_eq!(jwt_claim(&token, "nope"), None);
    assert_eq!(jwt_claim("kein-jwt", "xuid"), None);
}
