use super::*;

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

pub(super) fn varint(out: &mut Vec<u8>, mut v: i32) {
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

pub(super) async fn read_varint(s: &mut TcpStream) -> AppResult<i32> {
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

pub(super) fn packet(id: i32, body: &[u8]) -> Vec<u8> {
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

pub(super) async fn ping_inner(address: &str) -> AppResult<ServerStatus> {
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
