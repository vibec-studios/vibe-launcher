pub(super) fn sha1_hex(b: &[u8]) -> String {
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
pub(super) fn deobfuscate(s: &str) -> String {
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

pub(super) fn player_of(line: &str) -> Option<String> {
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
    pub(super) count: u32,
}

impl Watch {
    pub(super) const LIMIT: u32 = 10;

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
