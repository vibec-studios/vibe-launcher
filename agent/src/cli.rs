#[derive(Debug, Default, Clone)]
pub struct Args {
    pub command: Vec<String>,
    pub data_dir: Option<String>,
    pub config_dir: Option<String>,
    pub port: Option<u16>,
    pub bind: Option<String>,
    pub json: bool,
    pub service: bool,
    pub role: Option<String>,
    pub version: bool,
    pub help: bool,
}

pub fn parse<I: IntoIterator<Item = String>>(it: I) -> Result<Args, String> {
    let mut a = Args::default();
    let mut it = it.into_iter();
    while let Some(arg) = it.next() {
        let (key, inline) = match arg.split_once('=') {
            Some((k, v)) if k.starts_with("--") => (k.to_string(), Some(v.to_string())),
            _ => (arg.clone(), None),
        };
        let mut value = |name: &str| inline.clone().or_else(|| it.next()).ok_or_else(|| format!("{name} braucht einen Wert"));
        match key.as_str() {
            "--data-dir" => a.data_dir = Some(value("--data-dir")?),
            "--config-dir" => a.config_dir = Some(value("--config-dir")?),
            "--port" => a.port = Some(value("--port")?.parse().map_err(|_| "--port muss eine Zahl sein".to_string())?),
            "--bind" => a.bind = Some(value("--bind")?),
            "--role" => a.role = Some(value("--role")?),
            "--json" => a.json = true,
            "--service" => a.service = true,
            "--version" | "-V" => a.version = true,
            "--help" | "-h" => a.help = true,
            k if k.starts_with('-') => return Err(format!("Unbekannte Option: {k}")),
            _ => a.command.push(arg),
        }
    }
    Ok(a)
}

pub const HELP: &str = "Vibe Server Agent – verwaltet Minecraft-Server auf diesem Rechner

Aufruf:
  vibe-agent run [--service]        Agent starten (Vordergrund; --service = Windows-Dienst)
  vibe-agent pair [--role R] [--json]  Neuen Kopplungscode anzeigen (15 Minuten gültig)
  vibe-agent link [<code>]          Mit dem Vibe-Konto verbinden (Code aus dem Launcher eingeben oder
                                    ohne Code einen Code anzeigen, der im Launcher bestätigt wird)
  vibe-agent status [--json]        Prüfen, ob der Agent läuft (Exit 0 = läuft)
  vibe-agent service install        Als Dienst einrichten (systemd bzw. Windows-Dienst)
  vibe-agent service uninstall      Dienst entfernen
  vibe-agent --version

Optionen (auch als Umgebungsvariable):
  --data-dir <pfad>   VIBE_AGENT_DATA_DIR   Datenordner
  --config-dir <pfad> VIBE_AGENT_CONFIG_DIR Konfiguration (Standard: <data>/config)
  --port <n>          VIBE_AGENT_PORT       Port für API und Panel (Standard 25580)
  --bind <adresse>    VIBE_AGENT_BIND       Adresse (Standard 0.0.0.0)
";

#[cfg(test)]
mod tests {
    use super::*;

    fn p(v: &[&str]) -> Args {
        parse(v.iter().map(|s| s.to_string())).unwrap()
    }

    #[test]
    fn parses_flags() {
        let a = p(&["run", "--data-dir", "/srv/vibe", "--port=26000", "--bind", "::"]);
        assert_eq!(a.command, vec!["run"]);
        assert_eq!(a.data_dir.as_deref(), Some("/srv/vibe"));
        assert_eq!(a.port, Some(26000));
        assert_eq!(a.bind.as_deref(), Some("::"));
        assert!(p(&["--version"]).version);
        assert!(p(&["run", "--service"]).service);
        assert_eq!(p(&["service", "install"]).command, vec!["service", "install"]);
        assert!(parse(["--port".to_string(), "abc".to_string()]).is_err());
        assert!(parse(["--wat".to_string()]).is_err());
    }
}
