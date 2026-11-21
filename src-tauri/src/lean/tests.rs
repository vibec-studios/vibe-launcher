use super::watch::{should_enter, UNFOCUSED_MS};
use super::*;

#[test]
fn defaults_are_on() {
    let s = LeanSettings::default();
    assert!(s.enabled && s.reopen);
    let parsed: LeanSettings = serde_json::from_str("{}").unwrap();
    assert_eq!(parsed, s);
}

#[test]
fn enters_only_after_unfocused_delay_and_grace() {
    let now = 100_000;
    assert!(!should_enter(true, None, now, 0));
    assert!(!should_enter(false, Some(now - UNFOCUSED_MS + 1), now, 0));
    assert!(should_enter(false, Some(now - UNFOCUSED_MS), now, 0));
    assert!(!should_enter(false, Some(now - UNFOCUSED_MS), now, now + 1));
    assert!(!should_enter(false, None, now, 0));
}

#[test]
fn tray_texts_follow_language() {
    assert_eq!(tray::texts("de").open, "Vibe Launcher öffnen");
    assert_eq!(tray::texts("fr").open, "Open Vibe Launcher");
}
