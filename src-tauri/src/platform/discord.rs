//! Discord Rich Presence über die lokale IPC-Schnittstelle (ohne Fremd-Crate).
//! Windows: Named Pipe `\\.\pipe\discord-ipc-N`, sonst Unix-Socket `$XDG_RUNTIME_DIR/discord-ipc-N`.
//! Läuft in einem eigenen Thread; ist Discord nicht offen, wird alle 15 s still neu versucht.
//!
//! Die Anwendungs-ID kommt aus der Build-Umgebung `VIBE_DISCORD_CLIENT_ID` (Discord Developer Portal).
//! Ohne ID ist die Funktion einfach aus.
use serde_json::json;
use std::io::{Read, Write};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

pub const CLIENT_ID: Option<&str> = option_env!("VIBE_DISCORD_CLIENT_ID");

#[derive(Debug, Clone, PartialEq)]
pub struct Activity {
    pub details: String,
    pub state: Option<String>,
    /// Startzeit (ms seit 1970)
    pub start: Option<i64>,
    /// Name des kleinen Bilds (Asset-Key im Developer Portal, z. B. "fabric")
    pub small_image: Option<String>,
    pub small_text: Option<String>,
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
        let Some(id) = CLIENT_ID.filter(|s| !s.trim().is_empty()) else {
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
                    if sent.as_ref() == Some(&want) {
                        continue;
                    }
                    nonce += 1;
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

fn send_activity(c: &mut dyn Pipe, a: Option<&Activity>, nonce: u64) -> std::io::Result<()> {
    let activity = a.map(|a| {
        let mut v = json!({
            "details": truncate(&a.details),
            "assets": { "large_image": "logo", "large_text": "Vibe Launcher" },
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
            v["assets"]["small_text"] = json!(a.small_text.clone().unwrap_or_default());
        }
        v
    });
    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": activity },
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
        d.set(Some(Activity {
            details: "x".into(),
            state: None,
            start: None,
            small_image: None,
            small_text: None,
        }));
        assert!(!d.available());
    }
}
