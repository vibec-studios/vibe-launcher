use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn draft(msg: &str) -> Draft {
    Draft {
        kind: "bug".into(),
        message: msg.into(),
        contact: Some("  steve#1234 ".into()),
        locale: "de".into(),
        page: Some("/instances/abc?q=geheim".into()),
        instance_id: None,
        attach_logs: true,
        screenshots: vec![],
        link_account: false,
    }
}

#[test]
fn meta_contract() {
    let inst = json!({ "mc_version": "1.21.1", "loader": "fabric", "loader_version": "0.16.9", "mod_count": 3, "java": "Java 21.0.5 (Microsoft, x64)" });
    let m = build_meta(&draft("  Das Spiel stürzt beim Start ab. "), "1.0.0", "dev", "Windows 11 Pro", "x86_64", Some(inst)).unwrap();
    assert_eq!(m["kind"], "bug");
    assert_eq!(m["message"], "Das Spiel stürzt beim Start ab.");
    assert_eq!(m["contact"], "steve#1234");
    assert_eq!(m["app"], "launcher");
    assert_eq!(m["version"], "1.0.0");
    assert_eq!(m["channel"], "dev");
    assert_eq!(m["os"], "Windows 11 Pro");
    assert_eq!(m["arch"], "x86_64");
    assert_eq!(m["locale"], "de");
    // nur der Pfad, ohne Suchbegriffe
    assert_eq!(m["page"], "/instances/abc");
    assert_eq!(m["instance"]["loader"], "fabric");
    assert_eq!(m["instance"]["mod_count"], 3);
    let keys: Vec<_> = m.as_object().unwrap().keys().cloned().collect();
    assert_eq!(keys.len(), 11, "{keys:?}");

    // Grenzen
    assert!(build_meta(&draft("zu kurz"), "1", "release", "w", "x", None).is_err());
    assert!(build_meta(&draft(&"x".repeat(MESSAGE_MAX + 1)), "1", "release", "w", "x", None).is_err());
    assert!(build_meta(&draft(&"ä".repeat(MESSAGE_MAX)), "1", "release", "w", "x", None).is_ok());
    let mut d = draft("Lange genug für eine Meldung");
    d.contact = Some("c".repeat(CONTACT_MAX + 1));
    assert!(build_meta(&d, "1", "release", "w", "x", None).is_err());
    d.contact = Some("   ".into());
    d.kind = "idea".into();
    d.page = Some("javascript:alert(1)".into());
    let m = build_meta(&d, "1", "weird", "w", "x", None).unwrap();
    assert_eq!(m["contact"], Value::Null);
    assert_eq!(m["page"], Value::Null);
    assert_eq!(m["channel"], "release");
    assert_eq!(m["instance"], Value::Null);
    d.kind = "hack".into();
    assert!(build_meta(&d, "1", "release", "w", "x", None).is_err());
}

#[test]
fn cut_logs() {
    let dir = std::env::temp_dir().join(format!("vl-fb-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("latest.log");
    let lines: String = (0..5000).map(|i| format!("[12:00:00] [main/INFO]: Zeile {i}\n")).collect();
    std::fs::write(&p, &lines).unwrap();
    let (tail, len, cut) = read_cut(&p, 4096, Cut::Tail).unwrap();
    assert!(cut);
    assert_eq!(len, lines.len() as u64);
    assert!(tail.starts_with("[Vibe Launcher: Anfang gekürzt"));
    assert!(tail.ends_with("Zeile 4999\n"));
    // keine angeschnittene erste Zeile
    assert!(tail.lines().nth(1).unwrap().starts_with("[12:00:00]"));
    let (head, _, _) = read_cut(&p, 4096, Cut::Head).unwrap();
    assert!(head.starts_with("[12:00:00] [main/INFO]: Zeile 0\n"));
    assert!(head.trim_end().ends_with("nur die ersten 4 KB]"));
    let (small, _, cut) = read_cut(&p, 10 * 1024 * 1024, Cut::Tail).unwrap();
    assert!(!cut);
    assert_eq!(small, lines);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn clean_log_redacts() {
    let known = redact::Known { users: vec!["henny".into()], hosts: vec![] };
    let raw = "Pfad C:\\Users\\henny\\AppData\nToken --accessToken abcdefgh123 mail a.b@example.org\n";
    let l = clean_log("launcher.log", raw, 99, false, &known);
    assert_eq!(l.text, "Pfad C:\\Users\\<user>\\AppData\nToken --accessToken <redacted> mail <email>\n");
    assert_eq!(l.redactions, 3);
    assert_eq!(l.bytes, l.text.len() as u64);
    assert_eq!(l.original_bytes, 99);
}

#[test]
fn java_line() {
    use crate::minecraft::{LogLevel, LogLine};
    let line = |logger: Option<&str>, text: &str| LogLine { seq: 0, time: None, level: LogLevel::Launcher, thread: None, logger: logger.map(str::to_string), text: text.into() };
    let lines = vec![
        line(Some("Vibe Launcher"), "Java 21.0.5 (Microsoft, x64): C:\\Users\\henny\\java\\bin\\javaw.exe"),
        line(None, "Java 8 (fake): x"),
    ];
    assert_eq!(java_from_session(&lines).as_deref(), Some("Java 21.0.5 (Microsoft, x64)"));
    assert_eq!(java_from_session(&[]), None);
}

#[test]
fn images() {
    assert_eq!(sniff_image(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]), Some("image/png"));
    assert_eq!(sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
    assert_eq!(sniff_image(b"GIF89a"), None);
    assert_eq!(sanitize_name("C:\\x\\Mein Bild (1).PNG", "image/png"), "MeinBild1.png");
    assert_eq!(sanitize_name("äöü.jpeg", "image/jpeg"), "screenshot.jpg");
    let img = image::RgbaImage::from_pixel(64, 32, image::Rgba([10, 20, 30, 255]));
    let (bytes, mime) = encode_shot(&img).unwrap();
    assert_eq!(mime, "image/png");
    assert_eq!(sniff_image(&bytes), Some("image/png"));
}

// ------------------------------------------------------------------ Versand gegen lokalen Fake-Server

struct Captured {
    head: String,
    body: Vec<u8>,
}

/// Einmal-Server: nimmt eine Anfrage an, antwortet mit `status` + `body`, liefert die Anfrage zurück.
async fn fake_server(status: &'static str, extra: &'static str, reply: &'static str) -> (String, tokio::task::JoinHandle<Captured>) {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1/feedback", l.local_addr().unwrap());
    let h = tokio::spawn(async move {
        let (mut s, _) = l.accept().await.unwrap();
        let mut buf = Vec::new();
        let mut tmp = [0u8; 8192];
        let head_end = loop {
            let n = s.read(&mut tmp).await.unwrap();
            buf.extend_from_slice(&tmp[..n]);
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break i + 4;
            }
        };
        let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
        let lower = head.to_ascii_lowercase();
        let mut body = buf[head_end..].to_vec();
        if let Some(cl) = lower.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()) {
            while body.len() < cl {
                let n = s.read(&mut tmp).await.unwrap();
                body.extend_from_slice(&tmp[..n]);
            }
        } else {
            // chunked
            while !body.ends_with(b"0\r\n\r\n") {
                let n = s.read(&mut tmp).await.unwrap();
                if n == 0 {
                    break;
                }
                body.extend_from_slice(&tmp[..n]);
            }
            body = dechunk(&body);
        }
        let resp = format!("HTTP/1.1 {status}\r\ncontent-type: application/json\r\n{extra}content-length: {}\r\nconnection: close\r\n\r\n{reply}", reply.len());
        s.write_all(resp.as_bytes()).await.unwrap();
        s.shutdown().await.ok();
        Captured { head, body }
    });
    (url, h)
}

fn dechunk(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(off) = b[i..].windows(2).position(|w| w == b"\r\n") {
        let size = usize::from_str_radix(std::str::from_utf8(&b[i..i + off]).unwrap().trim(), 16).unwrap_or(0);
        i += off + 2;
        if size == 0 {
            break;
        }
        out.extend_from_slice(&b[i..i + size]);
        i += size + 2;
    }
    out
}

fn sample(bearer: Option<&str>) -> Prepared {
    Prepared {
        meta: json!({ "kind": "bug", "message": "Absturz beim Start", "app": "launcher" }),
        logs: vec![("launcher.log".into(), "INFO hallo <user>\n".into()), ("crash-2026-11-19_10.00.00-client.txt".into(), "---- Minecraft Crash Report ----\n".into())],
        shots: vec![("launcher.png".into(), "image/png".into(), vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3])],
        bearer: bearer.map(str::to_string),
        shot_ids: vec![],
    }
}

#[tokio::test]
async fn send_ok_multipart() {
    let (url, h) = fake_server("201 Created", "", r#"{"id":"fb_1","ticket":"VB-1042","token":"vtk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"#).await;
    let r = send_prepared(&reqwest::Client::new(), &url, &sample(Some("tok123"))).await;
    let token = Some("vtk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string());
    assert_eq!(r, SendResult::Sent { id: "fb_1".into(), ticket: "VB-1042".into(), token });
    assert!(!serde_json::to_string(&r).unwrap().contains("vtk_"));
    let c = h.await.unwrap();
    let head = c.head.to_ascii_lowercase();
    assert!(head.starts_with("post /api/v1/feedback http/1.1"));
    assert!(head.contains("content-type: multipart/form-data; boundary="));
    assert!(head.contains("authorization: bearer tok123"));
    let body = String::from_utf8_lossy(&c.body);
    assert!(body.contains("name=\"meta\""));
    assert!(body.contains("Content-Type: application/json"));
    assert!(body.contains(r#""message":"Absturz beim Start""#));
    assert_eq!(body.matches("name=\"log\"").count(), 2);
    assert!(body.contains("filename=\"launcher.log\""));
    assert!(body.contains("filename=\"crash-2026-11-19_10.00.00-client.txt\""));
    assert!(body.contains("Content-Type: text/plain"));
    assert!(body.contains("name=\"screenshot\"; filename=\"launcher.png\""));
    assert!(body.contains("Content-Type: image/png"));
}

#[tokio::test]
async fn send_without_account_has_no_auth_header() {
    let (url, h) = fake_server("201 Created", "", r#"{"id":"fb_2","ticket":"VB-7"}"#).await;
    let r = send_prepared(&reqwest::Client::new(), &url, &sample(None)).await;
    assert!(matches!(r, SendResult::Sent { .. }));
    assert!(!h.await.unwrap().head.to_ascii_lowercase().contains("authorization"));
}

#[tokio::test]
async fn send_rate_limited() {
    let (url, h) = fake_server("429 Too Many Requests", "retry-after: 120\r\n", r#"{"error":{"code":"rate_limited","message":"Zu viele Meldungen"}}"#).await;
    let r = send_prepared(&reqwest::Client::new(), &url, &sample(None)).await;
    assert_eq!(r, SendResult::RateLimited { retry_after_secs: Some(120), message: Some("Zu viele Meldungen".into()) });
    h.await.unwrap();
}

#[tokio::test]
async fn send_rejected() {
    let (url, h) = fake_server("413 Payload Too Large", "", r#"{"error":{"code":"too_large","message":"Anhang zu groß"}}"#).await;
    let r = send_prepared(&reqwest::Client::new(), &url, &sample(None)).await;
    assert_eq!(r, SendResult::Rejected { http: 413, code: Some("too_large".into()), message: Some("Anhang zu groß".into()) });
    h.await.unwrap();
}

#[tokio::test]
async fn send_offline() {
    // Port reservieren und wieder freigeben -> Verbindung wird abgelehnt
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    drop(l);
    let r = send_prepared(&reqwest::Client::new(), &format!("http://{addr}/api/v1/feedback"), &sample(None)).await;
    assert!(matches!(r, SendResult::Offline { .. }), "{r:?}");
}
