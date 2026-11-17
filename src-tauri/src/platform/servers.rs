//! Server-Liste (`servers.dat`, unkomprimiertes NBT) lesen/schreiben und Server per
//! Server-List-Ping (SLP, Protokoll ab 1.7) abfragen.
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

// ------------------------------------------------------------------ Minimales NBT (vollständig, verlustfrei)

#[derive(Debug, Clone, PartialEq)]
pub enum Nbt {
    End,
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<i8>),
    String(String),
    List(u8, Vec<Nbt>),
    Compound(Vec<(String, Nbt)>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

impl Nbt {
    fn id(&self) -> u8 {
        match self {
            Nbt::End => 0,
            Nbt::Byte(_) => 1,
            Nbt::Short(_) => 2,
            Nbt::Int(_) => 3,
            Nbt::Long(_) => 4,
            Nbt::Float(_) => 5,
            Nbt::Double(_) => 6,
            Nbt::ByteArray(_) => 7,
            Nbt::String(_) => 8,
            Nbt::List(..) => 9,
            Nbt::Compound(_) => 10,
            Nbt::IntArray(_) => 11,
            Nbt::LongArray(_) => 12,
        }
    }
    pub fn get(&self, k: &str) -> Option<&Nbt> {
        match self {
            Nbt::Compound(v) => v.iter().find(|(n, _)| n == k).map(|(_, t)| t),
            _ => None,
        }
    }
    fn str(&self) -> Option<&str> {
        match self {
            Nbt::String(s) => Some(s),
            _ => None,
        }
    }
    fn byte(&self) -> Option<i8> {
        match self {
            Nbt::Byte(b) => Some(*b),
            _ => None,
        }
    }
}

struct Reader<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> AppResult<&'a [u8]> {
        if self.p + n > self.b.len() {
            return Err(AppError::msg(
                "servers.dat ist beschädigt (unerwartetes Ende)",
            ));
        }
        let s = &self.b[self.p..self.p + n];
        self.p += n;
        Ok(s)
    }
    fn u8(&mut self) -> AppResult<u8> {
        Ok(self.take(1)?[0])
    }
    fn i16(&mut self) -> AppResult<i16> {
        Ok(i16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> AppResult<i32> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i64(&mut self) -> AppResult<i64> {
        Ok(i64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn string(&mut self) -> AppResult<String> {
        let n = self.i16()? as u16 as usize;
        // Modified UTF-8 – für normale Texte identisch mit UTF-8
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
    fn len(&mut self) -> AppResult<usize> {
        let n = self.i32()?;
        if n < 0 || n as usize > self.b.len() {
            return Err(AppError::msg("servers.dat ist beschädigt (Länge)"));
        }
        Ok(n as usize)
    }
    fn payload(&mut self, id: u8, depth: u32) -> AppResult<Nbt> {
        if depth > 64 {
            return Err(AppError::msg("servers.dat ist zu tief verschachtelt"));
        }
        Ok(match id {
            1 => Nbt::Byte(self.u8()? as i8),
            2 => Nbt::Short(self.i16()?),
            3 => Nbt::Int(self.i32()?),
            4 => Nbt::Long(self.i64()?),
            5 => Nbt::Float(f32::from_bits(self.i32()? as u32)),
            6 => Nbt::Double(f64::from_bits(self.i64()? as u64)),
            7 => {
                let n = self.len()?;
                Nbt::ByteArray(self.take(n)?.iter().map(|b| *b as i8).collect())
            }
            8 => Nbt::String(self.string()?),
            9 => {
                let t = self.u8()?;
                let n = self.len()?;
                let mut v = Vec::with_capacity(n.min(4096));
                for _ in 0..n {
                    v.push(self.payload(t, depth + 1)?);
                }
                Nbt::List(t, v)
            }
            10 => {
                let mut v = vec![];
                loop {
                    let t = self.u8()?;
                    if t == 0 {
                        break;
                    }
                    let name = self.string()?;
                    v.push((name, self.payload(t, depth + 1)?));
                }
                Nbt::Compound(v)
            }
            11 => {
                let n = self.len()?;
                Nbt::IntArray((0..n).map(|_| self.i32()).collect::<AppResult<_>>()?)
            }
            12 => {
                let n = self.len()?;
                Nbt::LongArray((0..n).map(|_| self.i64()).collect::<AppResult<_>>()?)
            }
            _ => {
                return Err(AppError::msg(format!(
                    "servers.dat: unbekannter NBT-Typ {id}"
                )))
            }
        })
    }
}

pub fn nbt_read(b: &[u8]) -> AppResult<Nbt> {
    let mut r = Reader { b, p: 0 };
    let t = r.u8()?;
    if t != 10 {
        return Err(AppError::msg("servers.dat: kein NBT-Compound"));
    }
    let _name = r.string()?;
    r.payload(10, 0)
}

fn w_str(out: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    out.extend((b.len().min(u16::MAX as usize) as u16).to_be_bytes());
    out.extend(&b[..b.len().min(u16::MAX as usize)]);
}

fn w_payload(out: &mut Vec<u8>, t: &Nbt) {
    match t {
        Nbt::End => {}
        Nbt::Byte(v) => out.push(*v as u8),
        Nbt::Short(v) => out.extend(v.to_be_bytes()),
        Nbt::Int(v) => out.extend(v.to_be_bytes()),
        Nbt::Long(v) => out.extend(v.to_be_bytes()),
        Nbt::Float(v) => out.extend(v.to_bits().to_be_bytes()),
        Nbt::Double(v) => out.extend(v.to_bits().to_be_bytes()),
        Nbt::ByteArray(v) => {
            out.extend((v.len() as i32).to_be_bytes());
            out.extend(v.iter().map(|b| *b as u8));
        }
        Nbt::String(s) => w_str(out, s),
        Nbt::List(id, v) => {
            out.push(if v.is_empty() { *id } else { v[0].id() });
            out.extend((v.len() as i32).to_be_bytes());
            for x in v {
                w_payload(out, x);
            }
        }
        Nbt::Compound(v) => {
            for (n, x) in v {
                out.push(x.id());
                w_str(out, n);
                w_payload(out, x);
            }
            out.push(0);
        }
        Nbt::IntArray(v) => {
            out.extend((v.len() as i32).to_be_bytes());
            for x in v {
                out.extend(x.to_be_bytes());
            }
        }
        Nbt::LongArray(v) => {
            out.extend((v.len() as i32).to_be_bytes());
            for x in v {
                out.extend(x.to_be_bytes());
            }
        }
    }
}

pub fn nbt_write(root: &Nbt) -> Vec<u8> {
    let mut out = vec![10u8];
    w_str(&mut out, "");
    w_payload(&mut out, root);
    out
}

// ------------------------------------------------------------------ servers.dat

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerEntry {
    pub name: String,
    /// Adresse wie im Spiel (Host[:Port])
    pub ip: String,
    /// Favicon als Base64-PNG (ohne data:-Präfix), vom Spiel gespeichert
    #[serde(default)]
    pub icon: Option<String>,
    /// Ressourcenpakete des Servers: None = fragen, true = erlauben, false = ablehnen
    #[serde(default)]
    pub accept_textures: Option<bool>,
    #[serde(default)]
    pub hidden: bool,
}

pub fn read_servers(path: &Path) -> AppResult<Vec<ServerEntry>> {
    let b = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    if b.is_empty() {
        return Ok(vec![]);
    }
    let root = nbt_read(&b)?;
    let mut out = vec![];
    if let Some(Nbt::List(_, list)) = root.get("servers") {
        for s in list {
            out.push(ServerEntry {
                name: s
                    .get("name")
                    .and_then(|x| x.str())
                    .unwrap_or("Minecraft-Server")
                    .to_string(),
                ip: s.get("ip").and_then(|x| x.str()).unwrap_or("").to_string(),
                icon: s.get("icon").and_then(|x| x.str()).map(String::from),
                accept_textures: s
                    .get("acceptTextures")
                    .and_then(|x| x.byte())
                    .map(|b| b != 0),
                hidden: s.get("hidden").and_then(|x| x.byte()).unwrap_or(0) != 0,
            });
        }
    }
    Ok(out)
}

/// Schreibt die Liste. Unbekannte Felder vorhandener Einträge (gleiche Adresse) bleiben erhalten.
pub fn write_servers(path: &Path, servers: &[ServerEntry]) -> AppResult<()> {
    let old: Vec<Nbt> = std::fs::read(path)
        .ok()
        .and_then(|b| nbt_read(&b).ok())
        .and_then(|r| match r.get("servers") {
            Some(Nbt::List(_, l)) => Some(l.clone()),
            _ => None,
        })
        .unwrap_or_default();
    let mut list = vec![];
    for s in servers {
        if s.ip.trim().is_empty() {
            continue;
        }
        let mut fields: Vec<(String, Nbt)> = old
            .iter()
            .find(|o| o.get("ip").and_then(|x| x.str()) == Some(s.ip.as_str()))
            .and_then(|o| match o {
                Nbt::Compound(v) => Some(v.clone()),
                _ => None,
            })
            .unwrap_or_default();
        let mut set = |k: &str, v: Option<Nbt>| {
            fields.retain(|(n, _)| n != k);
            if let Some(v) = v {
                fields.push((k.to_string(), v));
            }
        };
        set("name", Some(Nbt::String(s.name.clone())));
        set("ip", Some(Nbt::String(s.ip.trim().to_string())));
        set("icon", s.icon.clone().map(Nbt::String));
        set(
            "acceptTextures",
            s.accept_textures.map(|b| Nbt::Byte(b as i8)),
        );
        set("hidden", if s.hidden { Some(Nbt::Byte(1)) } else { None });
        list.push(Nbt::Compound(fields));
    }
    let root = Nbt::Compound(vec![("servers".into(), Nbt::List(10, list))]);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("dat_tmp");
    std::fs::write(&tmp, nbt_write(&root))?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ------------------------------------------------------------------ Adressen

/// "host", "host:port", "[ipv6]:port" -> (host, port). Prüft auf erlaubte Zeichen.
pub fn parse_address(addr: &str) -> AppResult<(String, u16)> {
    let a = addr.trim();
    let bad = || AppError::Invalid(format!("Ungültige Serveradresse: {a}"));
    if a.is_empty() || a.len() > 253 + 6 {
        return Err(bad());
    }
    let (host, port) = if let Some(rest) = a.strip_prefix('[') {
        let end = rest.find(']').ok_or_else(bad)?;
        let host = &rest[..end];
        let port = rest[end + 1..]
            .strip_prefix(':')
            .map(|p| p.parse::<u16>().map_err(|_| bad()))
            .transpose()?;
        (host.to_string(), port.unwrap_or(25565))
    } else {
        match a.rsplit_once(':') {
            Some((h, p)) if !h.contains(':') => {
                (h.to_string(), p.parse::<u16>().map_err(|_| bad())?)
            }
            _ => (a.to_string(), 25565),
        }
    };
    if host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':'))
    {
        return Err(bad());
    }
    Ok((host, port))
}

/// Quick Play (`--quickPlayMultiplayer`) gibt es ab Minecraft 1.20 bzw. Snapshot 23w14a.
pub fn supports_quick_play(mc: &str) -> bool {
    let num = |s: &str| {
        s.split(|c: char| !c.is_ascii_digit())
            .next()
            .and_then(|x| x.parse::<u32>().ok())
    };
    if let Some(rest) = mc.strip_prefix("1.") {
        return num(rest).is_some_and(|m| m >= 20);
    }
    if let Some((y, w)) = mc.split_once('w') {
        if let (Some(y), Some(w)) = (num(y), num(w)) {
            return y > 23 || (y == 23 && w >= 14);
        }
    }
    num(mc).is_some_and(|m| m >= 2)
}

// ------------------------------------------------------------------ Server List Ping

#[derive(Debug, Clone, Serialize, Default)]
pub struct ServerStatus {
    pub online: bool,
    /// MOTD mit §-Farbcodes (aus Text-Komponenten umgewandelt)
    pub motd: String,
    pub players_online: Option<i64>,
    pub players_max: Option<i64>,
    /// Namen einiger Spieler (falls der Server sie sendet)
    pub players_sample: Vec<String>,
    pub version: Option<String>,
    pub protocol: Option<i64>,
    /// data:image/png;base64,…
    pub favicon: Option<String>,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

fn varint(out: &mut Vec<u8>, mut v: i32) {
    loop {
        let mut b = (v & 0x7f) as u8;
        v = ((v as u32) >> 7) as i32;
        if v != 0 {
            b |= 0x80;
        }
        out.push(b);
        if v == 0 {
            break;
        }
    }
}

async fn read_varint(s: &mut TcpStream) -> AppResult<i32> {
    let mut v: i32 = 0;
    for i in 0..5 {
        let b = s.read_u8().await?;
        v |= ((b & 0x7f) as i32) << (7 * i);
        if b & 0x80 == 0 {
            return Ok(v);
        }
    }
    Err(AppError::msg("Ungültige Antwort (VarInt)"))
}

fn packet(id: i32, body: &[u8]) -> Vec<u8> {
    let mut inner = vec![];
    varint(&mut inner, id);
    inner.extend(body);
    let mut out = vec![];
    varint(&mut out, inner.len() as i32);
    out.extend(inner);
    out
}

/// Text-Komponente (JSON) oder String -> Text mit §-Codes.
pub fn component_to_legacy(v: &serde_json::Value) -> String {
    fn color_code(c: &str) -> Option<char> {
        Some(match c {
            "black" => '0',
            "dark_blue" => '1',
            "dark_green" => '2',
            "dark_aqua" => '3',
            "dark_red" => '4',
            "dark_purple" => '5',
            "gold" => '6',
            "gray" => '7',
            "dark_gray" => '8',
            "blue" => '9',
            "green" => 'a',
            "aqua" => 'b',
            "red" => 'c',
            "light_purple" => 'd',
            "yellow" => 'e',
            "white" => 'f',
            _ => return None,
        })
    }
    fn walk(v: &serde_json::Value, out: &mut String, inherited: &str) {
        match v {
            serde_json::Value::String(s) => out.push_str(s),
            serde_json::Value::Array(a) => {
                for x in a {
                    walk(x, out, inherited);
                }
            }
            serde_json::Value::Object(o) => {
                let mut fmt = inherited.to_string();
                if let Some(c) = o.get("color").and_then(|x| x.as_str()) {
                    if let Some(code) = color_code(c) {
                        fmt = format!("§{code}");
                    } else if c.starts_with('#') && c.len() == 7 {
                        // Hex-Farben: als Erweiterung §#rrggbb (Frontend versteht das)
                        fmt = format!("§{c}");
                    }
                }
                for (k, code) in [
                    ("bold", 'l'),
                    ("italic", 'o'),
                    ("underlined", 'n'),
                    ("strikethrough", 'm'),
                    ("obfuscated", 'k'),
                ] {
                    if o.get(k).and_then(|x| x.as_bool()) == Some(true) {
                        fmt.push('§');
                        fmt.push(code);
                    }
                }
                if let Some(t) = o.get("text").and_then(|x| x.as_str()) {
                    if !t.is_empty() {
                        out.push_str("§r");
                        out.push_str(&fmt);
                        out.push_str(t);
                    }
                } else if let Some(t) = o.get("translate").and_then(|x| x.as_str()) {
                    out.push_str("§r");
                    out.push_str(&fmt);
                    out.push_str(t);
                }
                if let Some(extra) = o.get("extra") {
                    walk(extra, out, &fmt);
                }
            }
            _ => {}
        }
    }
    let mut out = String::new();
    walk(v, &mut out, "");
    out.trim_start_matches("§r").to_string()
}

/// Server per SLP abfragen (Timeout 5 s). Fehler landen in `error`, nie als Err.
pub async fn ping(address: &str) -> ServerStatus {
    match tokio::time::timeout(Duration::from_secs(6), ping_inner(address)).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => ServerStatus {
            error: Some(e.to_string()),
            ..Default::default()
        },
        Err(_) => ServerStatus {
            error: Some("Zeitüberschreitung".into()),
            ..Default::default()
        },
    }
}

async fn ping_inner(address: &str) -> AppResult<ServerStatus> {
    let (host, port) = parse_address(address)?;
    let started = Instant::now();
    let mut s = tokio::time::timeout(
        Duration::from_secs(4),
        TcpStream::connect((host.as_str(), port)),
    )
    .await
    .map_err(|_| AppError::msg("Server antwortet nicht"))?
    .map_err(|e| AppError::msg(format!("Keine Verbindung: {e}")))?;
    let connect_ms = started.elapsed().as_millis() as u64;
    s.set_nodelay(true).ok();
    // Handshake: Protokoll -1 (= „egal“), Host, Port, nächster Zustand 1 (Status)
    let mut hs = vec![];
    varint(&mut hs, -1);
    varint(&mut hs, host.len() as i32);
    hs.extend(host.as_bytes());
    hs.extend(port.to_be_bytes());
    varint(&mut hs, 1);
    s.write_all(&packet(0x00, &hs)).await?;
    s.write_all(&packet(0x00, &[])).await?;
    let len = read_varint(&mut s).await?;
    if !(1..=2_000_000).contains(&len) {
        return Err(AppError::msg("Ungültige Antwort des Servers"));
    }
    let mut buf = vec![0u8; len as usize];
    s.read_exact(&mut buf).await?;
    // Paket-ID + String-Länge (VarInts) überspringen
    let mut p = 0;
    for _ in 0..2 {
        while p < buf.len() && buf[p] & 0x80 != 0 {
            p += 1;
        }
        p += 1;
    }
    let json: serde_json::Value = serde_json::from_slice(buf.get(p..).unwrap_or_default())
        .map_err(|_| AppError::msg("Antwort ist kein gültiges JSON"))?;
    // Latenz per Ping/Pong; einige Server schließen vorher – dann zählt die Verbindungszeit
    let t = Instant::now();
    let mut latency = connect_ms;
    if s.write_all(&packet(0x01, &12345678i64.to_be_bytes()))
        .await
        .is_ok()
    {
        if let Ok(Ok(_)) = tokio::time::timeout(Duration::from_secs(2), read_varint(&mut s)).await {
            latency = t.elapsed().as_millis() as u64;
        }
    }
    let desc = json.get("description").cloned().unwrap_or_default();
    Ok(ServerStatus {
        online: true,
        motd: component_to_legacy(&desc),
        players_online: json.pointer("/players/online").and_then(|x| x.as_i64()),
        players_max: json.pointer("/players/max").and_then(|x| x.as_i64()),
        players_sample: json
            .pointer("/players/sample")
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|p| p.get("name").and_then(|n| n.as_str()).map(String::from))
                    .take(12)
                    .collect()
            })
            .unwrap_or_default(),
        version: json
            .pointer("/version/name")
            .and_then(|x| x.as_str())
            .map(String::from),
        protocol: json.pointer("/version/protocol").and_then(|x| x.as_i64()),
        favicon: json
            .get("favicon")
            .and_then(|x| x.as_str())
            .filter(|f| f.starts_with("data:image/"))
            .map(String::from),
        latency_ms: Some(latency),
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn servers_roundtrip_keeps_unknown_fields() {
        let dir = std::env::temp_dir().join(format!("vl-servers-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("servers.dat");
        // Datei wie vom Spiel: mit unbekanntem Feld "preventsChatReports"
        let root = Nbt::Compound(vec![(
            "servers".into(),
            Nbt::List(
                10,
                vec![Nbt::Compound(vec![
                    ("ip".into(), Nbt::String("play.example.net".into())),
                    ("name".into(), Nbt::String("Beispiel".into())),
                    ("preventsChatReports".into(), Nbt::Byte(1)),
                ])],
            ),
        )]);
        std::fs::write(&p, nbt_write(&root)).unwrap();
        let mut list = read_servers(&p).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Beispiel");
        list[0].name = "Umbenannt".into();
        list.push(ServerEntry {
            name: "Neu".into(),
            ip: "localhost:25566".into(),
            icon: None,
            accept_textures: Some(true),
            hidden: false,
        });
        write_servers(&p, &list).unwrap();
        let back = nbt_read(&std::fs::read(&p).unwrap()).unwrap();
        let Some(Nbt::List(_, l)) = back.get("servers") else {
            panic!()
        };
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].get("name"), Some(&Nbt::String("Umbenannt".into())));
        assert_eq!(l[0].get("preventsChatReports"), Some(&Nbt::Byte(1)));
        assert_eq!(l[1].get("acceptTextures"), Some(&Nbt::Byte(1)));
        assert_eq!(read_servers(&p).unwrap()[1].ip, "localhost:25566");
        assert!(read_servers(&dir.join("fehlt.dat")).unwrap().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn quick_play_versions() {
        assert!(supports_quick_play("1.20.1"));
        assert!(supports_quick_play("1.21.4"));
        assert!(supports_quick_play("26.1"));
        assert!(supports_quick_play("23w14a"));
        assert!(!supports_quick_play("23w13a"));
        assert!(!supports_quick_play("1.19.4"));
        assert!(!supports_quick_play("1.8.9"));
    }

    #[test]
    fn addresses() {
        assert_eq!(
            parse_address("mc.hypixel.net").unwrap(),
            ("mc.hypixel.net".into(), 25565)
        );
        assert_eq!(
            parse_address("127.0.0.1:25599").unwrap(),
            ("127.0.0.1".into(), 25599)
        );
        assert_eq!(parse_address("[::1]:25570").unwrap(), ("::1".into(), 25570));
        assert!(parse_address("evil host; rm").is_err());
        assert!(parse_address("host:99999").is_err());
    }

    #[test]
    fn motd_components() {
        let v: serde_json::Value = serde_json::from_str(r#"{"text":"","extra":[{"text":"Vibe ","color":"gold","bold":true},{"text":"Server","color":"aqua"}]}"#).unwrap();
        assert_eq!(component_to_legacy(&v), "§6§lVibe §r§bServer");
        assert_eq!(
            component_to_legacy(&serde_json::json!("§aHallo")),
            "§aHallo"
        );
    }

    #[test]
    fn varint_encoding() {
        let mut v = vec![];
        varint(&mut v, 300);
        assert_eq!(v, vec![0xac, 0x02]);
        let mut v = vec![];
        varint(&mut v, -1);
        assert_eq!(v, vec![0xff, 0xff, 0xff, 0xff, 0x0f]);
    }
}
