use super::*;

#[test]
fn lenient_accounts_file() {
    let json = r#"{"active":"a","accounts":[
        {"id":"a","kind":"microsoft","username":"Steve","uuid":"u"},
        {"id":"b","kind":"offline","username":"Alt","uuid":"v"},
        {"kaputt":true}
    ]}"#;
    let f: AccountsFile = serde_json::from_str(json).unwrap();
    assert_eq!(f.accounts.len(), 1);
    assert_eq!(f.accounts[0].username, "Steve");
}

#[cfg(debug_assertions)]
#[test]
fn offline_uuids() {
    assert_eq!(offline_uuid("Notch").hyphenated().to_string(), "b50ad385-829d-3141-a216-7e7d7539ba7f");
    assert_eq!(offline_uuid("Notch").simple().to_string(), "b50ad385829d3141a2167e7d7539ba7f");
    assert_eq!(offline_uuid("Notch").get_version_num(), 3);
    // Groß-/Kleinschreibung zählt (wie Vanilla)
    assert_ne!(offline_uuid("notch"), offline_uuid("Notch"));
}

#[cfg(debug_assertions)]
#[test]
fn dev_offline() {
    std::env::set_var("VIBE_DEV_OFFLINE_ACCOUNT", "Notch");
    let a = dev_offline_account().unwrap();
    assert_eq!((a.username.as_str(), a.uuid.as_str()), ("Notch", "b50ad385829d3141a2167e7d7539ba7f"));
    assert_eq!((a.user_type.as_str(), a.access_token.as_str()), ("legacy", "0"));
    std::env::set_var("VIBE_DEV_OFFLINE_ACCOUNT", "ungültig!");
    assert!(dev_offline_account().is_none());
    std::env::remove_var("VIBE_DEV_OFFLINE_ACCOUNT");
    assert!(dev_offline_account().is_none());
}

#[cfg(debug_assertions)]
#[test]
fn offline_names() {
    for ok in ["abc", "Notch", "jeb_", "A_1_b_2_c_3_d_4_", "___"] {
        assert!(valid_offline_name(ok), "{ok}");
    }
    for bad in ["", "ab", "abcdefghijklmnopq", "mit leer", "Ümlaut", "a-b", "name!", "Tést"] {
        assert!(!valid_offline_name(bad), "{bad}");
    }
}

#[test]
fn accounts_file_has_no_secrets() {
    let f = AccountsFile {
        active: Some("x".into()),
        accounts: vec![StoredAccount {
            id: "x".into(),
            kind: AccountKind::Microsoft,
            username: "Steve".into(),
            uuid: "u".into(),
            skin_url: None,
            expires_at: Some(1),
            needs_relogin: false,
            xuid: Some("1".into()),
            added_at: 0,
        }],
    };
    let json = serde_json::to_string(&f).unwrap();
    assert!(!json.contains("token"));
}
