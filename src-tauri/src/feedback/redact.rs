//! Bereinigung von Logs vor dem Senden (docs/FEEDBACK.md).
//!
//! Ersetzt werden – in dieser Reihenfolge –
//! 1. JWTs (`eyJ….….…`) → `<token>`
//! 2. `Bearer <wert>` → `Bearer <token>`
//! 3. Start-Argumente mit Geheimnissen (`--accessToken x`, `--xuid x`, `--clientId x`, `--session x`) → `<redacted>`
//! 4. Schlüssel/Wert-Paare (`accessToken=…`, `"refresh_token": "…"`, `session_id: …`, `token:…`) → `<redacted>`
//! 5. E-Mail-Adressen → `<email>`
//! 6. Benutzername in Pfaden (`C:\Users\<name>`, `/home/<name>`, `/Users/<name>`) → `<user>`
//! 7. weitere bekannte Namen (OS-Benutzer, Rechnername) überall → `<user>` bzw. `<host>`
//! 8. IPv4/IPv6-Adressen (außer Loopback/0.0.0.0) → `<ip>`
//!
//! Das Ergebnis enthält die Anzahl der Ersetzungen (für die Vorschau).
use regex::{Captures, Regex};
use std::sync::OnceLock;

/// Bereinigter Text und Anzahl der Ersetzungen.
#[derive(Debug, Clone, PartialEq)]
pub struct Redacted {
    pub text: String,
    pub count: u32,
}

/// Namen, die zusätzlich überall ersetzt werden (OS-Benutzer, Rechnername).
#[derive(Debug, Clone, Default)]
pub struct Known {
    pub users: Vec<String>,
    pub hosts: Vec<String>,
}

impl Known {
    /// Aus der Umgebung des laufenden Prozesses.
    pub fn from_env() -> Self {
        let mut users = Vec::new();
        for k in ["USERNAME", "USER", "LOGNAME"] {
            if let Ok(v) = std::env::var(k) {
                users.push(v);
            }
        }
        if let Some(h) = dirs::home_dir().and_then(|h| h.file_name().map(|n| n.to_string_lossy().to_string())) {
            users.push(h);
        }
        let mut hosts = Vec::new();
        for k in ["COMPUTERNAME", "HOSTNAME"] {
            if let Ok(v) = std::env::var(k) {
                hosts.push(v);
            }
        }
        Known { users, hosts }
    }
}

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("regex"))
}

/// Datei-Endungen, die wie eine Top-Level-Domain aussehen (`mixins@modid.json` ist keine E-Mail).
const FILE_TLDS: &[&str] = &["json", "jar", "java", "class", "toml", "png", "txt", "log", "cfg", "properties", "zip", "js", "kt", "mixins", "refmap"];

pub fn redact(input: &str, known: &Known) -> Redacted {
    static JWT: OnceLock<Regex> = OnceLock::new();
    static BEARER: OnceLock<Regex> = OnceLock::new();
    static ARG: OnceLock<Regex> = OnceLock::new();
    static KV: OnceLock<Regex> = OnceLock::new();
    static MCTOKEN: OnceLock<Regex> = OnceLock::new();
    static EMAIL: OnceLock<Regex> = OnceLock::new();
    static PATH: OnceLock<Regex> = OnceLock::new();
    static IPV4: OnceLock<Regex> = OnceLock::new();
    static IPV6: OnceLock<Regex> = OnceLock::new();

    let mut count = 0u32;
    let mut s = input.to_string();

    // 1. JWTs
    let jwt = re(&JWT, r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}");
    s = replace_counted(jwt, &s, &mut count, |_| "<token>".into());

    // 2. Bearer
    let bearer = re(&BEARER, r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]{6,}");
    s = replace_counted(bearer, &s, &mut count, |c| format!("{} <token>", &c[1]));

    // 3. Start-Argumente mit Geheimnissen
    let arg = re(&ARG, r"(?i)(--(?:accessToken|xuid|clientId|session|uuid|password))(\s+|=)([^\s<>]+)");
    s = replace_counted(arg, &s, &mut count, |c| format!("{}{}<redacted>", &c[1], &c[2]));

    // 4a. Minecraft-Session `token:<access>:<uuid>`
    let mct = re(&MCTOKEN, r"\btoken:[A-Za-z0-9._-]{8,}(?::[0-9a-fA-F-]{32,36})?");
    s = replace_counted(mct, &s, &mut count, |_| "token:<redacted>".into());

    // 4b. Schlüssel/Wert-Paare: Schlüssel bleibt, Wert wird ersetzt (auch in JSON mit Anführungszeichen)
    let kv = re(
        &KV,
        r#"(?i)(["']?\b(?:access_?token|refresh_?token|client_?token|id_?token|auth_?token|session_?id|session_?token|x-?auth-?token|api_?key|password|passwd|secret|authorization|xuid|token)\b["']?\s*[:=]\s*["']?)([^\s"',;&}\]<>]+)"#,
    );
    s = replace_counted_if(kv, &s, &mut count, |c| {
        let v = &c[2];
        // schon ersetzt / leere Platzhalter / Wahrheitswerte nicht anfassen
        if v.starts_with('<') || matches!(v.to_ascii_lowercase().as_str(), "null" | "none" | "true" | "false" | "bearer" | "basic") {
            None
        } else {
            Some(format!("{}<redacted>", &c[1]))
        }
    });

    // 5. E-Mail-Adressen
    let email = re(&EMAIL, r"\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,24}))\b");
    s = replace_counted_if(email, &s, &mut count, |c| {
        let tld = c[2].to_ascii_lowercase();
        (!FILE_TLDS.contains(&tld.as_str())).then(|| "<email>".to_string())
    });

    // 6. Benutzername in Pfaden (Windows mit \ oder / und auch doppelt maskiert, macOS, Linux)
    // Namen mit Leerzeichen nur, wenn danach ein Trenner folgt (sonst würde Folgetext mitgenommen)
    let path = re(
        &PATH,
        r#"(?i)((?:\b[A-Z]:)?(?:\\\\|\\|/)+(?:Users|home|Benutzer)(?:\\\\|\\|/)+)(?:((?:[^\\/\s"'<>:|?*]+ )+[^\\/\s"'<>:|?*]+)([\\/])|([^\\/\s"'<>:|?*]+))"#,
    );
    s = replace_counted_if(path, &s, &mut count, |c| {
        let (name, sep) = match (c.get(2), c.get(4)) {
            (Some(n), _) => (n.as_str(), c.get(3).map_or("", |m| m.as_str())),
            (None, Some(n)) => (n.as_str(), ""),
            _ => return None,
        };
        let skip = ["<user>", "public", "default", "shared", "all users"];
        if skip.iter().any(|k| name.eq_ignore_ascii_case(k)) {
            None
        } else {
            Some(format!("{}<user>{sep}", &c[1]))
        }
    });

    // 7. Bekannte Namen überall (nur ab 3 Zeichen, sonst trifft es normale Wörter)
    for (names, repl) in [(&known.users, "<user>"), (&known.hosts, "<host>")] {
        for n in names {
            let n = n.trim();
            if n.chars().count() < 3 || n.starts_with('<') {
                continue;
            }
            let Ok(r) = Regex::new(&format!(r"(?i)(^|[^A-Za-z0-9_]){}($|[^A-Za-z0-9_])", regex::escape(n))) else { continue };
            // überlappende Treffer: wiederholen, bis nichts mehr ersetzt wird
            loop {
                let before = count;
                s = replace_counted(&r, &s, &mut count, |c| format!("{}{repl}{}", &c[1], &c[2]));
                if count == before {
                    break;
                }
            }
        }
    }

    // 8. IP-Adressen. Die Trennzeichen gehören zum Treffer -> wiederholen, damit direkt benachbarte Adressen auch
    // ersetzt werden (`<ip>` passt nicht mehr, behaltene Adressen zählen nicht -> endet).
    let ipv4 = re(&IPV4, r"(^|[^0-9A-Za-z._-])((?:\d{1,3}\.){3}\d{1,3})($|[^0-9A-Za-z._-]|\.(?:$|\s))");
    let ipv6 = re(&IPV6, r"(?i)(^|[^0-9a-z:])((?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})($|[^0-9a-z:])");
    for _ in 0..4 {
        let before = count;
        s = replace_counted_if(ipv4, &s, &mut count, |c| {
            let ip = &c[2];
            let octets: Vec<u32> = ip.split('.').filter_map(|o| o.parse().ok()).collect();
            let valid = octets.len() == 4 && octets.iter().all(|&o| o <= 255);
            let keep = !valid || ip == "127.0.0.1" || ip == "0.0.0.0" || ip == "255.255.255.255";
            (!keep).then(|| format!("{}<ip>{}", &c[1], &c[3]))
        });
        s = replace_counted_if(ipv6, &s, &mut count, |c| {
            // Mindestens drei Gruppen, sonst sind es Uhrzeiten o. Ä.
            let groups = c[2].split(':').filter(|g| !g.is_empty()).count();
            (groups >= 3).then(|| format!("{}<ip>{}", &c[1], &c[3]))
        });
        if count == before {
            break;
        }
    }

    Redacted { text: s, count }
}

fn replace_counted(r: &Regex, s: &str, count: &mut u32, f: impl Fn(&Captures) -> String) -> String {
    replace_counted_if(r, s, count, |c| Some(f(c)))
}

/// Wie `Regex::replace_all`, aber `f` darf einen Treffer unverändert lassen (`None`); zählt die Ersetzungen.
fn replace_counted_if(r: &Regex, s: &str, count: &mut u32, f: impl Fn(&Captures) -> Option<String>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for c in r.captures_iter(s) {
        let m = c.get(0).expect("match");
        if let Some(rep) = f(&c) {
            out.push_str(&s[last..m.start()]);
            out.push_str(&rep);
            last = m.end();
            *count += 1;
        }
    }
    out.push_str(&s[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(s: &str) -> String {
        redact(s, &Known::default()).text
    }

    #[test]
    fn tokens() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        assert_eq!(r(&format!("got {jwt} ok")), "got <token> ok");
        assert_eq!(r("Authorization: Bearer abc.DEF-123_xyz"), "Authorization: Bearer <token>");
        assert_eq!(r("--username Steve --accessToken 0123456789abcdef --version 1.21"), "--username Steve --accessToken <redacted> --version 1.21");
        assert_eq!(r("--xuid=2535412345678901 --clientId abc123=="), "--xuid=<redacted> --clientId <redacted>");
        assert_eq!(r(r#"{"accessToken":"abcdefgh12345","name":"x"}"#), r#"{"accessToken":"<redacted>","name":"x"}"#);
        assert_eq!(r("refresh_token=M.R3_BAY.abc&x=1"), "refresh_token=<redacted>&x=1");
        assert_eq!(r("session_id: 5f3c1b2a-aaaa"), "session_id: <redacted>");
        assert_eq!(r("sessionId = 'xyz987654'"), "sessionId = '<redacted>'");
        assert_eq!(
            r("Session: token:eyJraWQiOi.abcdefghijk:069a79f444e94726a5befca90e38aaf5"),
            "Session: token:<redacted>"
        );
        // Wahrheitswerte/null bleiben, bereits ersetzte Werte auch
        assert_eq!(r("token: null, password=false"), "token: null, password=false");
        assert_eq!(r("accessToken=<redacted>"), "accessToken=<redacted>");
    }

    #[test]
    fn emails() {
        assert_eq!(r("Konto max.mustermann+mc@example.co.uk angemeldet"), "Konto <email> angemeldet");
        // Mixin-/Mod-Angaben sind keine E-Mails
        assert_eq!(r("Mixin config sodium.mixins@sodium.json"), "Mixin config sodium.mixins@sodium.json");
    }

    #[test]
    fn user_paths() {
        assert_eq!(r(r"C:\Users\Henny\AppData\Roaming\VibeLauncher"), r"C:\Users\<user>\AppData\Roaming\VibeLauncher");
        assert_eq!(r("C:/Users/Max Muster/x"), "C:/Users/<user>/x");
        assert_eq!(r(r"C:\Users\henny und mehr"), r"C:\Users\<user> und mehr");
        assert_eq!(r(r#""path":"C:\\Users\\henny\\.minecraft""#), r#""path":"C:\\Users\\<user>\\.minecraft""#);
        assert_eq!(r("/home/steve/.local/share"), "/home/<user>/.local/share");
        assert_eq!(r("/Users/alex/Library"), "/Users/<user>/Library");
        assert_eq!(r(r"C:\Users\Public\Desktop"), r"C:\Users\Public\Desktop");
    }

    #[test]
    fn known_names() {
        let k = Known { users: vec!["henny".into(), "ab".into()], hosts: vec!["DESKTOP-7K2".into()] };
        let out = redact(r"OneDrive - henny\Docs on DESKTOP-7K2; ab bleibt; hennyx bleibt", &k);
        assert_eq!(out.text, r"OneDrive - <user>\Docs on <host>; ab bleibt; hennyx bleibt");
        assert_eq!(out.count, 2);
    }

    #[test]
    fn ips() {
        assert_eq!(r("Connecting to 192.168.178.20, 25565"), "Connecting to <ip>, 25565");
        assert_eq!(r("/203.0.113.7:25565 joined"), "/<ip>:25565 joined");
        assert_eq!(r("bound 127.0.0.1:8080 and 0.0.0.0"), "bound 127.0.0.1:8080 and 0.0.0.0");
        assert_eq!(r("addr 2001:db8:85a3:0:0:8a2e:370:7334 x"), "addr <ip> x");
        assert_eq!(r("addr fe80::1ff:fe23:4567 x"), "addr <ip> x");
        // Versionen, Uhrzeiten, ungültige Adressen bleiben
        assert_eq!(r("[12:34:56] Loading 1.20.1 and 999.1.1.1"), "[12:34:56] Loading 1.20.1 and 999.1.1.1");
        assert_eq!(r("forge-1.20.1-47.2.0.1.jar"), "forge-1.20.1-47.2.0.1.jar");
        assert_eq!(r("Satz endet mit 10.0.0.5."), "Satz endet mit <ip>.");
    }

    #[test]
    fn counts_and_leaves_normal_lines() {
        let line = "[12:00:01] [Render thread/INFO]: Loaded 214 mods (fabric-api 0.92.2+1.20.1)";
        let out = redact(line, &Known::default());
        assert_eq!(out.text, line);
        assert_eq!(out.count, 0);
        let out = redact("a@b.de und C:\\Users\\x\\y und 10.1.2.3", &Known::default());
        assert_eq!(out.count, 3);
    }
}
