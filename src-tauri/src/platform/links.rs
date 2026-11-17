//! Aktionen von außen: Kommandozeile (`--launch <id>`) und Deep-Links (`vibelauncher://…`).
//! Alles wird hier streng geprüft und dann als `AppAction` an das Frontend gereicht, das immer erst
//! nachfragt, bevor etwas passiert.
use serde::Serialize;

pub const SCHEME: &str = "vibelauncher";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppAction {
    /// Inhalt installieren (öffnet den Installationsdialog)
    Install {
        source: String,
        project_id: String,
        version: Option<String>,
    },
    /// Geteiltes Modpack (Vibe-Backend, kommt später)
    Pack { code: String },
    /// Instanz starten
    Launch { instance_id: String },
    /// Server beitreten (optional mit Instanz)
    Join {
        address: String,
        instance_id: Option<String>,
    },
    /// Einladung (Vibe-Backend, kommt später)
    Invite { id: String },
}

fn ok_id(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn decode(s: &str) -> Option<String> {
    urlencoding::decode(s).ok().map(|c| c.into_owned())
}

/// `vibelauncher://install/modrinth/AANobbMI?version=abc` usw. -> Aktion (None = ungültig/unbekannt).
pub fn parse_url(raw: &str) -> Option<AppAction> {
    let url = url::Url::parse(raw.trim()).ok()?;
    if url.scheme() != SCHEME {
        return None;
    }
    // vibelauncher://install/a/b -> host = "install", path = "/a/b"
    let mut parts: Vec<String> = Vec::new();
    if let Some(h) = url.host_str() {
        parts.push(h.to_string());
    }
    parts.extend(
        url.path()
            .split('/')
            .filter(|p| !p.is_empty())
            .filter_map(decode),
    );
    let q = |k: &str| {
        url.query_pairs()
            .find(|(n, _)| n == k)
            .map(|(_, v)| v.into_owned())
    };
    let kind = parts.first()?.to_ascii_lowercase();
    match (kind.as_str(), parts.len()) {
        ("install", 3) => {
            let source = parts[1].to_ascii_lowercase();
            let version = q("version").filter(|v| ok_id(v, 64));
            (matches!(source.as_str(), "modrinth" | "curseforge") && ok_id(&parts[2], 64)).then(
                || AppAction::Install {
                    source,
                    project_id: parts[2].clone(),
                    version,
                },
            )
        }
        ("pack", 2) => ok_id(&parts[1], 64).then(|| AppAction::Pack {
            code: parts[1].clone(),
        }),
        ("launch", 2) => ok_id(&parts[1], 128).then(|| AppAction::Launch {
            instance_id: parts[1].clone(),
        }),
        ("join", 2) => {
            let address = parts[1].clone();
            let instance_id = q("instance").filter(|i| ok_id(i, 128));
            super::servers::parse_address(&address)
                .ok()
                .map(|_| AppAction::Join {
                    address,
                    instance_id,
                })
        }
        ("invite", 2) => ok_id(&parts[1], 64).then(|| AppAction::Invite {
            id: parts[1].clone(),
        }),
        _ => None,
    }
}

/// Kommandozeile: `--launch <id>` / `--launch=<id>` sowie Deep-Link-URLs als Argument.
pub fn parse_args<I: IntoIterator<Item = String>>(args: I) -> Vec<AppAction> {
    let args: Vec<String> = args.into_iter().collect();
    let mut out = vec![];
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "--launch" {
            if let Some(id) = args.get(i + 1).filter(|id| ok_id(id, 128)) {
                out.push(AppAction::Launch {
                    instance_id: id.clone(),
                });
                i += 1;
            }
        } else if let Some(id) = a.strip_prefix("--launch=") {
            if ok_id(id, 128) {
                out.push(AppAction::Launch {
                    instance_id: id.to_string(),
                });
            }
        } else if a.starts_with(&format!("{SCHEME}:")) {
            if let Some(act) = parse_url(a) {
                out.push(act);
            }
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert_eq!(
            parse_url("vibelauncher://install/modrinth/AANobbMI?version=mc1.21-0.6"),
            Some(AppAction::Install {
                source: "modrinth".into(),
                project_id: "AANobbMI".into(),
                version: Some("mc1.21-0.6".into())
            })
        );
        assert_eq!(
            parse_url("vibelauncher://launch/survival-1"),
            Some(AppAction::Launch {
                instance_id: "survival-1".into()
            })
        );
        assert_eq!(
            parse_url("vibelauncher://join/play.example.net:25566?instance=abc"),
            Some(AppAction::Join {
                address: "play.example.net:25566".into(),
                instance_id: Some("abc".into())
            })
        );
        assert_eq!(
            parse_url("vibelauncher://pack/XyZ12"),
            Some(AppAction::Pack {
                code: "XyZ12".into()
            })
        );
        assert_eq!(
            parse_url("vibelauncher://invite/abc"),
            Some(AppAction::Invite { id: "abc".into() })
        );
        // Ungültiges
        assert_eq!(parse_url("vibelauncher://install/evil/../../x"), None);
        assert_eq!(parse_url("vibelauncher://launch/a%20b"), None);
        assert_eq!(parse_url("vibelauncher://join/bad%20host"), None);
        assert_eq!(parse_url("https://launch/x"), None);
        assert_eq!(parse_url("vibelauncher://unbekannt/x"), None);
    }

    #[test]
    fn args() {
        let a = parse_args(
            [
                "C:\\vibe-launcher.exe",
                "--launch",
                "my-inst",
                "--launch=other",
                "vibelauncher://launch/x",
            ]
            .map(String::from),
        );
        assert_eq!(
            a,
            vec![
                AppAction::Launch {
                    instance_id: "my-inst".into()
                },
                AppAction::Launch {
                    instance_id: "other".into()
                },
                AppAction::Launch {
                    instance_id: "x".into()
                }
            ]
        );
        assert!(parse_args(["exe", "--launch", "../böse"].map(String::from)).is_empty());
    }
}
