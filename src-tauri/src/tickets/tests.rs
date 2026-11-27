use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const TOK_A: &str = "vtk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TOK_B: &str = "vtk_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB-_";

fn saved_entry(id: &str, ticket: &str, token: &str) -> Saved {
    Saved { id: id.into(), ticket: ticket.into(), token: token.into(), added: 1 }
}

#[test]
fn token_format() {
    assert!(valid_token(TOK_A));
    assert!(valid_token(TOK_B));
    assert!(!valid_token("vtk_short"));
    assert!(!valid_token("abc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    assert!(!valid_token("vtk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));
}

#[test]
fn keys_and_lookup() {
    assert!(valid_key("VB-42"));
    assert!(valid_key("6f1c0a2e-1111-2222-3333-444455556666"));
    assert!(!valid_key("VB-42/../x"));
    assert!(!valid_key(""));
    let list = vec![saved_entry("6f1c", "VB-42", TOK_A)];
    assert_eq!(find(&list, "vb42").map(|s| s.token.as_str()), Some(TOK_A));
    assert_eq!(find(&list, "VB-42").map(|s| s.id.as_str()), Some("6f1c"));
    assert_eq!(find(&list, "6F1C").map(|s| s.id.as_str()), Some("6f1c"));
    assert!(find(&list, "VB-43").is_none());
}

#[test]
fn upsert_replaces_and_caps() {
    let list = upsert(vec![saved_entry("a", "VB-1", TOK_A)], saved_entry("a", "VB-1", TOK_B));
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].token, TOK_B);
    let mut big = Vec::new();
    for i in 0..SAVED_MAX {
        big.push(saved_entry(&i.to_string(), &format!("VB-{i}"), &format!("vtk_{i:043}")));
    }
    let big = upsert(big, saved_entry("new", "VB-new", TOK_A));
    assert_eq!(big.len(), SAVED_MAX);
    assert_eq!(big.last().unwrap().id, "new");
    assert_eq!(big[0].id, "1");
    let left = without(big, &[TOK_A.to_string()]);
    assert_eq!(left.len(), SAVED_MAX - 1);
}

#[test]
fn background_skips_old_rejected() {
    let list = vec![saved_entry("a", "VB-1", TOK_A), saved_entry("b", "VB-2", TOK_B)];
    let now = 100 * 24 * 3600 * 1000;
    let mut known = HashMap::new();
    known.insert("a".to_string(), Known { status: "rejected".into(), activity: 0 });
    known.insert("b".to_string(), Known { status: "rejected".into(), activity: now - 1000 });
    assert_eq!(poll_tokens(&list, &known, now, true), vec![TOK_B.to_string()]);
    assert_eq!(poll_tokens(&list, &known, now, false).len(), 2);
}

#[test]
fn merge_strips_tokens_and_sorts() {
    let account = vec![json!({ "id": "a", "ticket": "VB-1", "lastActivityAt": "2026-11-20T10:00:00.000Z" })];
    let local = vec![
        json!({ "id": "a", "ticket": "VB-1", "token": TOK_A, "lastActivityAt": "2026-11-20T10:00:00.000Z" }),
        json!({ "id": "b", "ticket": "VB-2", "token": TOK_B, "lastActivityAt": "2026-11-27T10:00:00.000Z" }),
        json!({ "ticket": "kaputt" }),
    ];
    let items = merge(account, local);
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["id"], "b");
    assert_eq!(items[0]["local"], true);
    assert_eq!(items[1]["id"], "a");
    assert_eq!(items[1]["local"], true);
    assert!(!serde_json::to_string(&items).unwrap().contains("vtk_"));
}

#[test]
fn reply_meta() {
    let m = meta_of("  Hallo  ", &["r1".into()]).unwrap();
    assert_eq!(m, json!({ "body": "Hallo", "fulfills": ["r1"] }));
    assert!(meta_of(&"x".repeat(BODY_MAX + 1), &[]).is_err());
    assert!(meta_of("", &vec!["r".to_string(); FULFILLS_MAX + 1]).is_err());
    assert_eq!(log_kinds(&["game".into(), "../etc".into(), "crash".into()]), vec!["game".to_string(), "crash".to_string()]);
}

#[test]
fn report_payload() {
    let r = ChatReport { chat_id: "c9".into(), message_ids: vec!["1201".into()], reason: "harassment".into(), details: Some("  böse  ".into()), locale: Some("de".into()) };
    let b = report_body(&r, "release").unwrap();
    assert_eq!(b["chatId"], "c9");
    assert_eq!(b["messageIds"], json!(["1201"]));
    assert_eq!(b["details"], "böse");
    assert_eq!(b["client"]["app"], "launcher");
    let bad = ChatReport { reason: "nope".into(), ..r.clone() };
    assert!(report_body(&bad, "release").is_err());
    let plain = ChatReport { message_ids: vec![], details: Some("   ".into()), ..r };
    let b = report_body(&plain, "dev").unwrap();
    assert!(b.get("messageIds").is_none());
    assert!(b.get("details").is_none());
}

#[test]
fn error_mapping() {
    let e = error_of(401, None, br#"{"error":{"code":"token_expired","message":"abgelaufen"}}"#);
    assert_eq!((e.kind, e.code.as_str()), ("auth", "token_expired"));
    assert!(e.message.contains("token_expired"));
    let e = error_of(429, Some(120), br#"{"error":{"code":"rate_limited","message":"langsam"}}"#);
    assert_eq!((e.kind, e.retry_after), ("ticket", Some(120)));
    let e = error_of(409, None, br#"{"error":{"code":"conflict","message":"x","details":{"ticket":"VB-9"}}}"#);
    assert_eq!(e.details["ticket"], "VB-9");
    let e = error_of(502, None, b"Bad Gateway");
    assert_eq!(e.code, "http_502");
}

#[test]
fn attachment_kinds() {
    let png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2];
    let a = attachment_data(Some("image/png"), png);
    assert!(a.data_url.unwrap().starts_with("data:image/png;base64,"));
    let a = attachment_data(Some("text/plain; charset=utf-8"), b"[main/INFO] hallo".to_vec());
    assert_eq!(a.mime, "text/plain");
    assert_eq!(a.text.as_deref(), Some("[main/INFO] hallo"));
    let a = attachment_data(Some("image/png"), b"<html>".to_vec());
    assert!(a.data_url.is_none());
}

async fn fake_server(status: &'static str, reply: &'static str) -> (String, tokio::task::JoinHandle<String>) {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api/v1/tickets/VB-42", l.local_addr().unwrap());
    let h = tokio::spawn(async move {
        let (mut s, _) = l.accept().await.unwrap();
        let mut buf = vec![0u8; 16 * 1024];
        let n = s.read(&mut buf).await.unwrap();
        let head = String::from_utf8_lossy(&buf[..n]).to_string();
        let resp = format!("HTTP/1.1 {status}\r\ncontent-type: application/json\r\nretry-after: 30\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}", reply.len());
        s.write_all(resp.as_bytes()).await.unwrap();
        s.shutdown().await.ok();
        head
    });
    (url, h)
}

#[tokio::test]
async fn exec_sends_both_auth_headers() {
    let (url, h) = fake_server("200 OK", r#"{"id":"a","ticket":"VB-42","status":"waiting"}"#).await;
    let auth = Auth { bearer: Some("acc".into()), ticket: Some(TOK_A.into()) };
    let v = json_of(&exec(reqwest::Client::new().get(&url), &auth).await.unwrap()).unwrap();
    assert_eq!(v["status"], "waiting");
    let head = h.await.unwrap().to_ascii_lowercase();
    assert!(head.contains("authorization: bearer acc"));
    assert!(head.contains(&format!("x-ticket-token: {}", TOK_A.to_ascii_lowercase())));
}

#[tokio::test]
async fn exec_maps_errors() {
    let (url, h) = fake_server("429 Too Many Requests", r#"{"error":{"code":"rate_limited","message":"langsam"}}"#).await;
    let e = exec(reqwest::Client::new().get(&url), &Auth::default()).await.err().unwrap();
    assert_eq!((e.http, e.code.as_str(), e.retry_after), (429, "rate_limited", Some(30)));
    assert!(!h.await.unwrap().to_ascii_lowercase().contains("x-ticket-token"));
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    drop(l);
    let e = exec(reqwest::Client::new().get(format!("http://{addr}/api/v1/tickets")), &Auth::default()).await.err().unwrap();
    assert_eq!(e.kind, "network");
}
