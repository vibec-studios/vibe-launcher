use super::*;

#[test]
fn signed_manifest_is_accepted() {
    let s = Signer::new();
    let m = manifest_for("3", &package_files("3"));
    let b = body(&m);
    assert_eq!(parse_manifest(&b, &s.sign(&b), &s.public).unwrap(), m);
}

#[test]
fn tampered_manifest_is_rejected() {
    let s = Signer::new();
    let b = body(&manifest_for("3", &package_files("3")));
    let sig = s.sign(&b);
    let forged = String::from_utf8(b.clone()).unwrap().replace("\"3\"", "\"4\"").into_bytes();
    assert_eq!(parse_manifest(&forged, &sig, &s.public), Err(ModelError::Signature));
    let other = Signer::new();
    assert_eq!(parse_manifest(&b, &sig, &other.public), Err(ModelError::Signature));
    assert_eq!(parse_manifest(&b, b"kein base64", &s.public), Err(ModelError::Signature));
    assert_eq!(parse_manifest(&b, &sig, &[]), Err(ModelError::Signature));
}

#[test]
fn invalid_manifests_are_rejected_even_when_signed() {
    let s = Signer::new();
    let check = |m: &Manifest| {
        let b = body(m);
        parse_manifest(&b, &s.sign(&b), &s.public)
    };
    let good = manifest_for("3", &package_files("3"));
    let mut m = good.clone();
    m.files[2].asset = "../../evil.bin".into();
    assert!(matches!(check(&m), Err(ModelError::Invalid(_))));
    let mut m = good.clone();
    m.files.pop();
    assert!(matches!(check(&m), Err(ModelError::Invalid(_))));
    let mut m = good.clone();
    m.files[1].name = "weights.bin".into();
    assert!(matches!(check(&m), Err(ModelError::Invalid(_))));
    let mut m = good.clone();
    m.format = 99;
    assert_eq!(check(&m), Err(ModelError::Unsupported(99)));
    let mut m = good.clone();
    m.version = "..".into();
    assert!(matches!(check(&m), Err(ModelError::Invalid(_))));
    let mut m = good.clone();
    m.files[0].sha256 = "ABC".into();
    assert!(matches!(check(&m), Err(ModelError::Invalid(_))));
    let mut m = good;
    m.files[0].size = 0;
    assert!(matches!(check(&m), Err(ModelError::Invalid(_))));
}

#[test]
fn builtin_key_is_a_valid_ed25519_key() {
    assert_eq!(key().len(), 32);
}

#[test]
fn versions_compare_numerically() {
    use std::cmp::Ordering::*;
    assert_eq!(compare_versions("10", "9"), Greater);
    assert_eq!(compare_versions("3.1", "3"), Greater);
    assert_eq!(compare_versions("3", "3.0"), Equal);
    assert_eq!(compare_versions("3", "4"), Less);
    let m = manifest_for("4", &package_files("4"));
    assert!(newer(None, &m) && newer(Some("3"), &m));
    assert!(!newer(Some("4"), &m) && !newer(Some("5"), &m));
}

#[test]
fn manifest_checks_are_rate_limited() {
    let now = 1_000_000_000;
    let fresh = CheckState { checked_at: Some(now - 1000), ..Default::default() };
    assert!(!due(&fresh, true, now));
    assert!(due(&fresh, false, now));
    let old = CheckState { checked_at: Some(now - CHECK_EVERY_MS - 1), ..Default::default() };
    assert!(due(&old, true, now));
    let failed = CheckState { failed_at: Some(now - 1000), ..Default::default() };
    assert!(!due(&failed, false, now));
    assert!(!due(&failed, true, now));
    let retry = CheckState { failed_at: Some(now - RETRY_AFTER_FAIL_MS - 1), ..Default::default() };
    assert!(due(&retry, false, now));
    let future = CheckState { checked_at: Some(now + 10_000), ..Default::default() };
    assert!(due(&future, true, now));
}

#[test]
fn asset_urls_live_next_to_the_manifest() {
    assert_eq!(
        asset_url(MANIFEST_URL, "vibefix-v3-weights.bin"),
        "https://github.com/vibec-studios/vibe-launcher/releases/download/vibefix-model/vibefix-v3-weights.bin"
    );
}
