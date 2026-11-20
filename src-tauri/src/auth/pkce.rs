use base64::Engine;
use sha2::{Digest, Sha256};
use url::Url;

pub const AUTHORIZE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
pub const REDIRECT_URI: &str = "https://login.microsoftonline.com/common/oauth2/nativeclient";

#[derive(Debug, Clone)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Redirect {
    Code(String),
    Error { error: String, description: String },
    StateMismatch,
    None,
}

fn random_b64(uuids: usize) -> String {
    let bytes: Vec<u8> = (0..uuids).flat_map(|_| *uuid::Uuid::new_v4().as_bytes()).collect();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn challenge_for(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

impl Default for Pkce {
    fn default() -> Self {
        Self::new()
    }
}

impl Pkce {
    pub fn new() -> Self {
        let verifier = random_b64(4);
        Pkce { challenge: challenge_for(&verifier), verifier, state: random_b64(1) }
    }

    pub fn authorize_url(&self, client_id: &str, scope: &str) -> Url {
        let mut u = Url::parse(AUTHORIZE_URL).expect("authorize url");
        u.query_pairs_mut()
            .append_pair("client_id", client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", REDIRECT_URI)
            .append_pair("response_mode", "query")
            .append_pair("scope", scope)
            .append_pair("prompt", "select_account")
            .append_pair("code_challenge", &self.challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &self.state);
        u
    }
}

fn is_redirect_target(u: &Url) -> bool {
    u.scheme() == "https" && u.host_str() == Some("login.microsoftonline.com") && u.path().trim_end_matches('/') == "/common/oauth2/nativeclient"
}

fn is_error_page(u: &Url) -> bool {
    u.host_str().is_some_and(|h| h == "login.live.com" || h == "login.microsoftonline.com") && u.path().ends_with("/err.srf")
}

fn params(u: &Url) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = u.query_pairs().into_owned().collect();
    if let Some(f) = u.fragment() {
        v.extend(url::form_urlencoded::parse(f.as_bytes()).into_owned());
    }
    v
}

pub fn parse_redirect(u: &Url, expected_state: &str) -> Redirect {
    let redirect = is_redirect_target(u);
    if !redirect && !is_error_page(u) {
        return Redirect::None;
    }
    let p = params(u);
    let get = |k: &str| p.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
    if let Some(error) = get("error") {
        return Redirect::Error { error, description: get("error_description").unwrap_or_default() };
    }
    if !redirect {
        return Redirect::None;
    }
    if get("state").as_deref() != Some(expected_state) {
        return Redirect::StateMismatch;
    }
    match get("code").filter(|c| !c.is_empty()) {
        Some(c) => Redirect::Code(c),
        None => Redirect::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn rfc7636_challenge() {
        assert_eq!(challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn fresh_values() {
        let a = Pkce::new();
        let b = Pkce::new();
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.state, b.state);
        assert!((43..=128).contains(&a.verifier.len()));
        assert!(a.verifier.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
        assert_eq!(a.challenge, challenge_for(&a.verifier));
    }

    #[test]
    fn authorize_parameters() {
        let p = Pkce::new();
        let u = p.authorize_url("cid", "XboxLive.signin offline_access");
        assert!(u.as_str().starts_with(AUTHORIZE_URL));
        let q: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "cid");
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["redirect_uri"], REDIRECT_URI);
        assert_eq!(q["prompt"], "select_account");
        assert_eq!(q["scope"], "XboxLive.signin offline_access");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], p.challenge);
        assert_eq!(q["state"], p.state);
    }

    #[test]
    fn redirect_with_code() {
        let u = url("https://login.microsoftonline.com/common/oauth2/nativeclient?code=M.C5_abc&state=s1");
        assert_eq!(parse_redirect(&u, "s1"), Redirect::Code("M.C5_abc".into()));
        assert_eq!(parse_redirect(&u, "anders"), Redirect::StateMismatch);
        let no_state = url("https://login.microsoftonline.com/common/oauth2/nativeclient?code=x");
        assert_eq!(parse_redirect(&no_state, "s1"), Redirect::StateMismatch);
    }

    #[test]
    fn redirect_with_error() {
        let u = url("https://login.microsoftonline.com/common/oauth2/nativeclient?error=access_denied&error_description=The+user+has+denied&state=s1");
        assert_eq!(parse_redirect(&u, "s1"), Redirect::Error { error: "access_denied".into(), description: "The user has denied".into() });
        let page = url("https://login.live.com/err.srf?lc=1031#error=invalid_request&error_description=The+provided+value+for+the+input+parameter+%27redirect_uri%27+is+not+valid.");
        assert!(matches!(parse_redirect(&page, "s1"), Redirect::Error { error, description } if error == "invalid_request" && description.contains("redirect_uri")));
    }

    #[test]
    fn other_pages_ignored() {
        for s in [
            "https://login.live.com/oauth20_authorize.srf?client_id=x&code=nope",
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?code=x&state=s1",
            "https://evil.example/common/oauth2/nativeclient?code=x&state=s1",
            "http://login.microsoftonline.com/common/oauth2/nativeclient?code=x&state=s1",
            "https://login.microsoftonline.com/common/oauth2/nativeclient?state=s1",
            "https://login.live.com/err.srf?lc=1031",
        ] {
            assert_eq!(parse_redirect(&url(s), "s1"), Redirect::None, "{s}");
        }
    }
}
