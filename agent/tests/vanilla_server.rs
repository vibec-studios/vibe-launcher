mod common;

use futures::{SinkExt, StreamExt};
use reqwest::Method;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

async fn wait_state(a: &common::Agent, token: &str, id: &str, want: &[&str], limit: Duration) -> Value {
    let deadline = Instant::now() + limit;
    loop {
        let (_, st) = a.get(token, &format!("/servers/{id}/status")).await;
        if want.iter().any(|w| st["state"] == *w) {
            return st;
        }
        assert!(Instant::now() < deadline, "Server-Status {st} statt {want:?}");
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

#[tokio::test]
#[ignore = "lädt Java und den Vanilla-Server (~150 MB) und startet Minecraft – mit --ignored ausführen"]
async fn vanilla_server_lifecycle() {
    let a = common::start("vanilla").await;
    let token = a.pair_with_proof().await;
    let mc_port = common::free_port();
    let (s, created) = a
        .send(&token, Method::POST, "/servers", json!({ "name": "Vanilla Test", "mc_version": "1.21.1", "loader": { "kind": "vanilla", "version": null }, "port": mc_port, "memory_mb": 1024 }))
        .await;
    assert_eq!(s, 200, "{created}");
    let id = created["server"]["id"].as_str().unwrap().to_string();
    let t = a.wait_task(&token, created["task_id"].as_str().unwrap(), Duration::from_secs(900)).await;
    assert_eq!(t["status"], "done", "Installation: {t}");
    let (_, srv) = a.get(&token, &format!("/servers/{id}")).await;
    assert_eq!(srv["install_state"], "installed");

    let (s, _) = a.send(&token, Method::PUT, &format!("/servers/{id}/properties"), json!({ "values": { "motd": "Vibe Agent Test", "online-mode": "false" } })).await;
    assert_eq!(s, 200);
    let (s, _) = a.send(&token, Method::POST, &format!("/servers/{id}/eula"), json!({})).await;
    assert_eq!(s, 200);

    let fp = a.info().await["fingerprint"].as_str().unwrap().to_string();
    let connector = tokio_tungstenite::Connector::Rustls(Arc::new(common::pinned_tls(&fp)));
    let url = format!("wss://127.0.0.1:{}/api/v1/ws", a.port);
    let (mut ws, _) = tokio_tungstenite::connect_async_tls_with_config(url, None, false, Some(connector)).await.expect("WS");
    ws.send(Message::Text(json!({ "t": "auth", "token": token }).to_string().into())).await.unwrap();
    ws.send(Message::Text(json!({ "t": "subscribe", "topics": ["servers", format!("log:{id}")] }).to_string().into())).await.unwrap();

    let (s, e) = a.send(&token, Method::POST, &format!("/servers/{id}/start"), json!({})).await;
    assert_eq!(s, 204, "{e}");
    let (s, e) = a.send(&token, Method::DELETE, &format!("/servers/{id}"), json!({})).await;
    assert_eq!(s, 409, "{e}");

    let deadline = Instant::now() + Duration::from_secs(240);
    let mut saw_hello = false;
    let mut saw_done = false;
    while Instant::now() < deadline && !saw_done {
        let Ok(Some(Ok(Message::Text(t)))) = tokio::time::timeout(Duration::from_secs(30), ws.next()).await else { continue };
        let v: Value = serde_json::from_str(&t).unwrap();
        if v["t"] == "hello" {
            saw_hello = true;
        }
        if v["event"] == "server://log" {
            saw_done = v["data"]["lines"].as_array().unwrap().iter().any(|l| l["text"].as_str().unwrap_or_default().contains("Done ("));
        }
    }
    assert!(saw_hello, "kein hello über den WebSocket");
    assert!(saw_done, "Server meldet nicht „Done“");
    wait_state(&a, &token, &id, &["running"], Duration::from_secs(30)).await;

    ws.send(Message::Text(json!({ "t": "command", "id": "c1", "server_id": id, "command": "list" }).to_string().into())).await.unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut replied = false;
    while Instant::now() < deadline && !replied {
        let Ok(Some(Ok(Message::Text(t)))) = tokio::time::timeout(Duration::from_secs(10), ws.next()).await else { continue };
        let v: Value = serde_json::from_str(&t).unwrap();
        replied = v["t"] == "reply" && v["id"] == "c1" && v["ok"] == true;
    }
    assert!(replied, "keine Antwort auf den Konsolenbefehl");

    let (s, e) = a.send(&token, Method::POST, &format!("/servers/{id}/stop"), json!({})).await;
    assert_eq!(s, 204, "{e}");
    wait_state(&a, &token, &id, &["stopped"], Duration::from_secs(120)).await;
    let (s, _) = a.send(&token, Method::DELETE, &format!("/servers/{id}"), json!({})).await;
    assert_eq!(s, 204);
}
