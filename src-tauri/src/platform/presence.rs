//! Discord-Status aus Launcher-Zustand und `session.json` zusammenbauen (docs/PLAY-LINKS.md §4). Rein und testbar.
use super::discord::{Activity, WEBSITE};
use crate::play::Session;

/// Eingaben für den Discord-Status.
#[derive(Debug, Clone, Default)]
pub struct PresenceInput {
    /// None = im Launcher
    pub instance_name: Option<String>,
    /// (Asset-Key, Text), z. B. ("fabric", "Fabric · Minecraft 1.21.1")
    pub loader: Option<(String, String)>,
    pub session: Option<Session>,
    /// Welt/Server aus dem Start (ohne Vibey Client bzw. ohne `session.json`)
    pub launch_world: Option<String>,
    pub launch_server: Option<String>,
    /// Einstellung „Server und Welt anzeigen“
    pub details: bool,
    pub english: bool,
    /// Startzeit (ms)
    pub start: i64,
    /// Öffentliche Icon-URL der Instanz (Modrinth)
    pub icon_url: Option<String>,
    /// Geprüfter Spiel-Link (wird nur beim Hosten gezeigt)
    pub play_link: Option<String>,
}

fn count(s: &Session) -> String {
    match (s.players, s.max_players) {
        (Some(p), Some(m)) => format!(" ({p}/{m})"),
        (Some(p), None) => format!(" ({p})"),
        _ => String::new(),
    }
}

pub fn build_activity(i: &PresenceInput) -> Activity {
    let en = i.english;
    let tr = |de: &str, english: &str| if en { english.to_string() } else { de.to_string() };
    let website = ("Vibe Launcher".to_string(), WEBSITE.to_string());
    let Some(name) = &i.instance_name else {
        return Activity { details: tr("Im Launcher", "In the launcher"), start: Some(i.start), buttons: vec![website], ..Default::default() };
    };
    let mut buttons = vec![];
    let line = match &i.session {
        Some(s) => match s.state.as_str() {
            "hosting" => {
                if let Some(link) = &i.play_link {
                    buttons.push((tr("Beitreten", "Join"), link.clone()));
                }
                Some(match s.world.as_deref().filter(|w| i.details && !w.trim().is_empty()) {
                    Some(w) => format!("{} {w}{}", tr("Hostet", "Hosting"), count(s)),
                    None => format!("{}{}", tr("Hostet eine Welt", "Hosting a world"), count(s)),
                })
            }
            "multiplayer" => Some(match s.server.as_deref().filter(|x| i.details && !x.trim().is_empty()) {
                Some(srv) => format!("{} {srv}", tr("Auf", "On")),
                None => tr("Im Mehrspieler", "In multiplayer"),
            }),
            "singleplayer" => Some(tr("Einzelspieler", "Singleplayer")),
            _ => Some(tr("Im Hauptmenü", "In the main menu")),
        },
        None => match (&i.launch_server, &i.launch_world) {
            (Some(srv), _) if i.details => Some(format!("{} {srv}", tr("Auf", "On"))),
            (Some(_), _) => Some(tr("Im Mehrspieler", "In multiplayer")),
            (None, Some(_)) => Some(tr("Einzelspieler", "Singleplayer")),
            _ => i.loader.as_ref().map(|l| l.1.clone()),
        },
    };
    buttons.push(website);
    Activity {
        details: format!("{} {name}", tr("Spielt", "Playing")),
        state: line,
        start: Some(i.start),
        large_image: i.icon_url.clone(),
        large_text: Some(name.clone()),
        small_image: i.loader.as_ref().map(|l| l.0.clone()),
        small_text: i.loader.as_ref().map(|l| l.1.clone()),
        buttons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PresenceInput {
        PresenceInput {
            instance_name: Some("Cobblemon Abenteuer".into()),
            loader: Some(("fabric".into(), "Fabric · Minecraft 1.21.1".into())),
            details: true,
            start: 1000,
            ..Default::default()
        }
    }
    fn session(state: &str) -> Session {
        Session { schema: 1, state: state.into(), server: Some("hypixel.net".into()), world: Some("Neue Welt".into()), players: Some(3), max_players: Some(8), ..Default::default() }
    }

    #[test]
    fn launcher_state() {
        let a = build_activity(&PresenceInput { start: 5, ..Default::default() });
        assert_eq!(a.details, "Im Launcher");
        assert_eq!(a.start, Some(5));
        assert_eq!(a.buttons, vec![("Vibe Launcher".to_string(), WEBSITE.to_string())]);
        assert_eq!(build_activity(&PresenceInput { english: true, ..Default::default() }).details, "In the launcher");
    }

    #[test]
    fn hosting_with_link() {
        let mut i = base();
        i.session = Some(session("hosting"));
        i.play_link = Some("https://axolite.cc/j/k3x9q2".into());
        i.icon_url = Some("https://cdn.modrinth.com/x.png".into());
        let a = build_activity(&i);
        assert_eq!(a.details, "Spielt Cobblemon Abenteuer");
        assert_eq!(a.state.as_deref(), Some("Hostet Neue Welt (3/8)"));
        assert_eq!(a.buttons.len(), 2);
        assert_eq!(a.buttons[0], ("Beitreten".to_string(), "https://axolite.cc/j/k3x9q2".to_string()));
        assert_eq!(a.buttons[1].0, "Vibe Launcher");
        assert_eq!(a.large_image.as_deref(), Some("https://cdn.modrinth.com/x.png"));
        assert_eq!(a.small_image.as_deref(), Some("fabric"));
        // „Server und Welt anzeigen“ aus: Weltname versteckt
        i.details = false;
        assert_eq!(build_activity(&i).state.as_deref(), Some("Hostet eine Welt (3/8)"));
        i.english = true;
        let en = build_activity(&i);
        assert_eq!(en.buttons[0].0, "Join");
        assert_eq!(en.details, "Playing Cobblemon Abenteuer");
    }

    #[test]
    fn other_states() {
        let mut i = base();
        i.session = Some(session("multiplayer"));
        assert_eq!(build_activity(&i).state.as_deref(), Some("Auf hypixel.net"));
        assert_eq!(build_activity(&i).buttons.len(), 1);
        // Server per Server-Regel versteckt (kein `server`)
        i.session.as_mut().unwrap().server = None;
        assert_eq!(build_activity(&i).state.as_deref(), Some("Im Mehrspieler"));
        i.session = Some(session("singleplayer"));
        assert_eq!(build_activity(&i).state.as_deref(), Some("Einzelspieler"));
        i.session = Some(session("menu"));
        assert_eq!(build_activity(&i).state.as_deref(), Some("Im Hauptmenü"));
        // ohne session.json: Loader-Zeile bzw. Start-Kontext
        i.session = None;
        assert_eq!(build_activity(&i).state.as_deref(), Some("Fabric · Minecraft 1.21.1"));
        i.launch_server = Some("play.example.net".into());
        assert_eq!(build_activity(&i).state.as_deref(), Some("Auf play.example.net"));
        i.details = false;
        assert_eq!(build_activity(&i).state.as_deref(), Some("Im Mehrspieler"));
        // Spiel-Link nur beim Hosten
        i.session = Some(session("multiplayer"));
        i.play_link = Some("https://axolite.cc/j/k3x9q2".into());
        assert!(build_activity(&i).buttons.iter().all(|b| b.0 != "Beitreten"));
    }
}
