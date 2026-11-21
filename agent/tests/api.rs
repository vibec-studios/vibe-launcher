mod common;

use reqwest::Method;
use serde_json::{json, Value};

#[tokio::test]
async fn pairing_auth_and_path_guard() {
    let a = common::start("api").await;
    let info = a.info().await;
    assert_eq!(info["api_version"], 1);
    assert_eq!(info["paired"], false);

    let r = a.http.get(format!("{}/servers", a.base)).send().await.unwrap();
    assert_eq!(r.status().as_u16(), 401);
    assert_eq!(r.headers().get("x-vibe-agent-api").unwrap(), "1");
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["error"]["code"], "unauthorized");

    let bad = a.http.post(format!("{}/pair", a.base)).json(&json!({ "code": "AAAA-AAAA" })).send().await.unwrap();
    assert_eq!(bad.status().as_u16(), 401);

    let token = a.pair_with_proof().await;
    assert_eq!(a.info().await["paired"], true);
    let (s, me) = a.get(&token, "/me").await;
    assert_eq!(s, 200);
    assert_eq!(me["user"]["role"], "owner");

    let (s, created) = a
        .send(&token, Method::POST, "/servers", json!({ "name": "Test Server", "mc_version": "1.21.1", "loader": { "kind": "vanilla", "version": null }, "port": common::free_port() }))
        .await;
    assert_eq!(s, 200, "{created}");
    let id = created["server"]["id"].as_str().unwrap().to_string();
    let task = created["task_id"].as_str().unwrap().to_string();
    let _ = a.send(&token, Method::POST, &format!("/tasks/{task}/cancel"), json!({})).await;

    let (s, e) = a.get(&token, &format!("/servers/{id}/files?path=../..")).await;
    assert_eq!(s, 403);
    assert_eq!(e["error"]["code"], "path_denied");
    let put = a.http.put(format!("{}/servers/{id}/files/content?path=vibe-server.json", a.base)).bearer_auth(&token).body("{}").send().await.unwrap();
    assert_eq!(put.status().as_u16(), 403);
    let put = a.http.put(format!("{}/servers/{id}/files/content?path=config/test.txt", a.base)).bearer_auth(&token).body("hallo").send().await.unwrap();
    assert_eq!(put.status().as_u16(), 204);
    let got = a.http.get(format!("{}/servers/{id}/files/content?path=config/test.txt", a.base)).bearer_auth(&token).send().await.unwrap().text().await.unwrap();
    assert_eq!(got, "hallo");
    let (s, list) = a.get(&token, &format!("/servers/{id}/files?path=config")).await;
    assert_eq!(s, 200);
    assert_eq!(list["entries"][0]["name"], "test.txt");

    let (s, inv) = a.send(&token, Method::POST, "/users/invite", json!({ "role": "viewer" })).await;
    assert_eq!(s, 200);
    let viewer: Value = a.http.post(format!("{}/pair", a.base)).json(&json!({ "code": inv["code"], "client_kind": "panel" })).send().await.unwrap().json().await.unwrap();
    let vt = viewer["token"].as_str().unwrap();
    assert_eq!(viewer["user"]["role"], "viewer");
    let (s, _) = a.get(vt, "/servers").await;
    assert_eq!(s, 200);
    let (s, e) = a.send(vt, Method::POST, &format!("/servers/{id}/start"), json!({})).await;
    assert_eq!(s, 403, "{e}");
    let (s, _) = a.get(vt, "/agent/audit").await;
    assert_eq!(s, 403);

    let (s, audit) = a.get(&token, "/agent/audit?limit=50").await;
    assert_eq!(s, 200);
    assert!(audit.as_array().unwrap().iter().any(|e| e["action"] == "server.create"));

    let (s, rot) = a.send(&token, Method::POST, "/tokens/rotate", json!({})).await;
    assert_eq!(s, 200);
    let (s, _) = a.get(&token, "/me").await;
    assert_eq!(s, 401);
    let (s, _) = a.get(rot["token"].as_str().unwrap(), "/me").await;
    assert_eq!(s, 200);

    let panel = a.http.get(format!("https://127.0.0.1:{}/", a.port)).send().await.unwrap();
    assert!(panel.headers().get("content-type").unwrap().to_str().unwrap().starts_with("text/html"));

    let st = a.cli(&["status"]);
    assert!(st.status.success(), "status: {}", String::from_utf8_lossy(&st.stdout));
}

#[test]
fn cli_basics() {
    let out = std::process::Command::new(common::bin()).arg("--version").output().unwrap();
    assert!(out.status.success());
    assert!(String::from_utf8_lossy(&out.stdout).starts_with("vibe-agent "));
    let dir = common::temp_dir("status");
    let out = std::process::Command::new(common::bin())
        .args(["status", "--data-dir", dir.to_str().unwrap(), "--port", &common::free_port().to_string()])
        .output()
        .unwrap();
    assert!(!out.status.success());
    let _ = std::fs::remove_dir_all(dir);
}
