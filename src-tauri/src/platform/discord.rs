//! Discord Rich Presence über die lokale IPC-Schnittstelle (ohne Fremd-Crate).
//! Windows: Named Pipe `\\.\pipe\discord-ipc-N`, sonst Unix-Socket `$XDG_RUNTIME_DIR/discord-ipc-N`.
//! Läuft in einem eigenen Thread; ist Discord nicht offen, wird alle 15 s still neu versucht.
//!
//! Die Anwendungs-ID steht in [`DISCORD_APP_ID`] (Discord Developer Portal, gehört der Vibe-Org, nicht geheim);
//! ein Build kann sie über `VIBE_DISCORD_CLIENT_ID` setzen. Ohne ID ist die Funktion einfach aus.
//! Bild-Assets (Keys) im Developer Portal: siehe docs/DISCORD.md.
use serde_json::json;
use std::io::{Read, Write};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

/// Discord-Application-ID der Vibe-Org. Leer = Rich Presence aus. (Platzhalter, bis die Anwendung angelegt ist.)
pub const DISCORD_APP_ID: &str = "";

/// Wirksame ID: Konstante, sonst Build-Umgebung. Nur Ziffern (Discord-Snowflake).
pub fn app_id() -> Option<&'static str> {
    let ok = |s: &&str| !s.trim().is_empty() && s.trim().bytes().all(|b| b.is_ascii_digit());
    Some(DISCORD_APP_ID).filter(ok).or(option_env!("VIBE_DISCORD_CLIENT_ID").filter(ok)).map(str::trim)
}

/// Asset-Key des Vibe-Logos (Standard für das große Bild)
pub const ASSET_LOGO: &str = "logo";
/// Website für den Knopf „Vibe Launcher“
pub const WEBSITE: &str = "https://vibec-studios.github.io/";

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Activity {
    pub details: String,
    pub state: Option<String>,
    /// Startzeit (ms seit 1970)
    pub start: Option<i64>,
    /// Großes Bild: Asset-Key oder öffentliche https-URL (z. B. Modrinth-Icon); None = Vibe-Logo
    pub large_image: Option<String>,
    pub large_text: Option<String>,
    /// Name des kleinen Bilds (Asset-Key im Developer Portal, z. B. "fabric")
    pub small_image: Option<String>,
    pub small_text: Option<String>,
    /// Höchstens zwei URL-Knöpfe (Beschriftung, URL)
    pub buttons: Vec<(String, String)>,
}

trait Pipe: Read + Write + Send {}
impl<T: Read + Write + Send> Pipe for T {}

#[derive(Clone)]
pub struct Discord {
    tx: Option<Sender<Option<Activity>>>,
}

impl Discord {
    /// Startet den Hintergrund-Thread (nur mit gesetzter Client-ID).
    pub fn start() -> Discord {
        let Some(id) = app_id() else {
            return Discord { tx: None };
        };
        let (tx, rx) = mpsc::channel::<Option<Activity>>();
        let id = id.trim().to_string();
        std::thread::Builder::new()
            .name("discord-rpc".into())
            .spawn(move || {
                let mut conn: Option<Box<dyn Pipe>> = None;
                let mut want: Option<Activity> = None;
                let mut sent: Option<Option<Activity>> = None;
                let mut nonce = 0u64;
                let mut last = std::time::Instant::now();
                loop {
                    match rx.recv_timeout(Duration::from_secs(15)) {
                        Ok(a) => want = a,
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                    // Nur die neueste Anfrage zählt
                    while let Ok(a) = rx.try_recv() {
                        want = a;
                    }
                    if conn.is_none() {
                        if want.is_none() && sent.is_none() {
                            continue; // nichts zu zeigen, keine Verbindung nötig
                        }
                        conn = connect(&id);
                        sent = None;
                    }
                    let Some(c) = conn.as_mut() else { continue };
                    // Unverändert: nur gelegentlich erneut senden – so merken wir, wenn Discord geschlossen wurde
                    if sent.as_ref() == Some(&want) && last.elapsed() < Duration::from_secs(60) {
                        continue;
                    }
                    nonce += 1;
                    last = std::time::Instant::now();
                    if send_activity(c.as_mut(), want.as_ref(), nonce).is_ok() {
                        sent = Some(want.clone());
                    } else {
                        conn = None;
                    }
                }
            })
            .ok();
        Discord { tx: Some(tx) }
    }

    pub fn available(&self) -> bool {
        self.tx.is_some()
    }

    /// Gewünschte Anzeige setzen (None = löschen).
    pub fn set(&self, a: Option<Activity>) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(a);
        }
    }
}

fn frame(op: u32, payload: &serde_json::Value) -> Vec<u8> {
    let body = payload.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend(op.to_le_bytes());
    out.extend((body.len() as u32).to_le_bytes());
    out.extend(body);
    out
}

fn read_frame(c: &mut dyn Pipe) -> std::io::Result<(u32, Vec<u8>)> {
    let mut h = [0u8; 8];
    c.read_exact(&mut h)?;
    let op = u32::from_le_bytes(h[..4].try_into().unwrap());
    let len = u32::from_le_bytes(h[4..].try_into().unwrap()) as usize;
    if len > 1 << 20 {
        return Err(std::io::Error::other("Discord-Antwort zu groß"));
    }
    let mut b = vec![0u8; len];
    c.read_exact(&mut b)?;
    Ok((op, b))
}

fn connect(client_id: &str) -> Option<Box<dyn Pipe>> {
    for i in 0..10 {
        let Some(mut c) = open_pipe(i) else { continue };
        if c.write_all(&frame(0, &json!({ "v": 1, "client_id": client_id })))
            .is_err()
        {
            continue;
        }
        // READY abwarten (op 1); op 2 = Fehler/geschlossen
        match read_frame(c.as_mut()) {
            Ok((1, _)) => return Some(c),
            _ => continue,
        }
    }
    None
}

#[cfg(windows)]
fn open_pipe(i: u32) -> Option<Box<dyn Pipe>> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(format!(r"\\.\pipe\discord-ipc-{i}"))
        .ok()
        .map(|f| Box::new(f) as Box<dyn Pipe>)
}

#[cfg(unix)]
fn open_pipe(i: u32) -> Option<Box<dyn Pipe>> {
    let mut dirs: Vec<std::path::PathBuf> = vec![];
    for v in ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"] {
        if let Some(d) = std::env::var_os(v) {
            let d = std::path::PathBuf::from(d);
            // Flatpak/Snap-Discord legen den Socket in Unterordnern ab
            dirs.push(d.join("app/com.discordapp.Discord"));
            dirs.push(d.join("snap.discord"));
            dirs.push(d);
        }
    }
    dirs.push("/tmp".into());
    for d in dirs {
        if let Ok(s) = std::os::unix::net::UnixStream::connect(d.join(format!("discord-ipc-{i}"))) {
            let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
            return Some(Box::new(s));
        }
    }
    None
}

/// Activity-Objekt für `SET_ACTIVITY`.
pub fn activity_json(a: &Activity) -> serde_json::Value {
    let mut v = json!({
        "details": truncate(&a.details),
        "assets": {
            "large_image": a.large_image.clone().unwrap_or_else(|| ASSET_LOGO.into()),
            "large_text": truncate(a.large_text.as_deref().unwrap_or("Vibe Launcher")),
        },
        "instance": false,
    });
    if let Some(s) = &a.state {
        v["state"] = json!(truncate(s));
    }
    if let Some(t) = a.start {
        v["timestamps"] = json!({ "start": t / 1000 });
    }
    if let Some(img) = &a.small_image {
        v["assets"]["small_image"] = json!(img);
        v["assets"]["small_text"] = json!(truncate(a.small_text.as_deref().unwrap_or("")));
    }
    let buttons: Vec<_> = a
        .buttons
        .iter()
        .filter(|(l, u)| !l.trim().is_empty() && (u.starts_with("https://") || u.starts_with("http://")) && u.len() <= 512)
        .take(2)
        .map(|(l, u)| json!({ "label": l.chars().take(32).collect::<String>(), "url": u }))
        .collect();
    if !buttons.is_empty() {
        v["buttons"] = json!(buttons);
    }
    v
}

fn send_activity(c: &mut dyn Pipe, a: Option<&Activity>, nonce: u64) -> std::io::Result<()> {
    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": a.map(activity_json) },
        "nonce": nonce.to_string(),
    });
    c.write_all(&frame(1, &payload))?;
    let (op, _) = read_frame(c)?;
    if op == 2 {
        return Err(std::io::Error::other(
            "Discord hat die Verbindung geschlossen",
        ));
    }
    Ok(())
}

/// Discord erlaubt 2–128 Zeichen.
fn truncate(s: &str) -> String {
    let mut t: String = s.chars().take(127).collect();
    while t.chars().count() < 2 {
        t.push(' ');
    }
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_layout() {
        let f = frame(1, &json!({"a": 1}));
        assert_eq!(&f[..4], &1u32.to_le_bytes());
        assert_eq!(&f[4..8], &7u32.to_le_bytes());
        assert_eq!(&f[8..], br#"{"a":1}"#);
        assert_eq!(truncate("x"), "x ");
        assert_eq!(truncate(&"y".repeat(300)).chars().count(), 127);
    }

    /// Kein Discord-Client/keine ID: darf nie blockieren oder abstürzen.
    #[test]
    fn without_discord_is_noop() {
        let d = Discord { tx: None };
        d.set(Some(Activity { details: "x".into(), ..Default::default() }));
        assert!(!d.available());
    }

    #[test]
    fn activity_payload() {
        let a = Activity {
            details: "Spielt Cobblemon".into(),
            state: Some("Hostet Neue Welt (3/8)".into()),
            start: Some(1_795_040_000_000),
            large_image: Some("https://cdn.modrinth.com/data/abc/icon.png".into()),
            large_text: Some("Cobblemon".into()),
            small_image: Some("fabric".into()),
            small_text: Some("Fabric · Minecraft 1.21.1".into()),
            buttons: vec![
                ("Beitreten".into(), "https://vibe.henny.dev/j/k3x9q2".into()),
                ("Vibe Launcher".into(), WEBSITE.into()),
                ("Dritter".into(), "https://x.example".into()),
            ],
        };
        let v = activity_json(&a);
        assert_eq!(v["timestamps"]["start"], 1_795_040_000);
        assert_eq!(v["assets"]["large_image"], "https://cdn.modrinth.com/data/abc/icon.png");
        assert_eq!(v["buttons"].as_array().unwrap().len(), 2);
        assert_eq!(v["buttons"][0]["url"], "https://vibe.henny.dev/j/k3x9q2");
        let plain = activity_json(&Activity { details: "Im Launcher".into(), ..Default::default() });
        assert_eq!(plain["assets"]["large_image"], ASSET_LOGO);
        assert!(plain.get("buttons").is_none());
        // Platzhalter: ohne ID kein RPC
        if option_env!("VIBE_DISCORD_CLIENT_ID").is_none() && DISCORD_APP_ID.is_empty() {
            assert!(app_id().is_none());
        }
    }
}
