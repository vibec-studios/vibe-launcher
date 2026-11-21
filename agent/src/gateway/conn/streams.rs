use super::*;

pub(super) fn spawn_req(conn: &Arc<Conn>, f: ReqFrame, body: Body) {
    let id = f.id.clone();
    let c = conn.clone();
    let task = tokio::spawn(async move {
        let id = f.id.clone();
        dispatch::handle(c.router.clone(), f, body, c.out.clone(), c.acks.clone()).await;
        c.reqs.lock().remove(&id);
    });
    conn.reqs.lock().insert(id, task.abort_handle());
}

pub(super) fn ws_open(conn: &Arc<Conn>, d: &Value) {
    let sid = d["sid"].as_str().unwrap_or_default().to_string();
    let user: Option<GwUser> = serde_json::from_value(d["user"].clone()).ok();
    let path = d["path"].as_str().unwrap_or_default();
    let authed = user.and_then(|u| crate::api::auth::gateway_user(&conn.ctx, &u.via()).ok());
    let (Some(authed), true) = (authed, path == "/api/v1/ws") else {
        let _ = conn.out.try_send(frame("ws.closed", json!({ "sid": sid, "code": 4404, "reason": "Nicht verfügbar" })));
        return;
    };
    let (in_tx, in_rx) = mpsc::channel::<String>(64);
    let (o_tx, mut o_rx) = mpsc::channel::<String>(256);
    conn.sockets.lock().insert(sid.clone(), in_tx);
    let _ = conn.out.try_send(frame("ws.opened", json!({ "sid": sid })));
    let c = conn.clone();
    let ctx = conn.ctx.clone();
    let s2 = sid.clone();
    tokio::spawn(async move { crate::api::ws::session(ctx, Some(authed), None, in_rx, o_tx).await });
    tokio::spawn(async move {
        while let Some(m) = o_rx.recv().await {
            for part in dispatch::split_ws_message(&m, WS_MSG_MAX) {
                if c.out.send(frame("ws.message", json!({ "sid": s2, "data": part }))).await.is_err() {
                    return;
                }
            }
            if !c.sockets.lock().contains_key(&s2) {
                return;
            }
        }
        c.sockets.lock().remove(&s2);
        let _ = c.out.send(frame("ws.closed", json!({ "sid": s2, "code": 1000, "reason": "" }))).await;
    });
}

pub(super) async fn upload_begin(conn: &Arc<Conn>, d: &Value) {
    let uid = d["uid"].as_str().unwrap_or_default().to_string();
    let mut fr = d.clone();
    fr["id"] = json!(uid);
    let Ok(frame_req) = serde_json::from_value::<ReqFrame>(fr) else {
        let _ = conn.out.send(frame("upload.error", json!({ "uid": uid, "message": "Ungültiger Upload" }))).await;
        return;
    };
    let path = conn.ctx.core.paths.tmp().join(format!("gw-upload-{}.part", uuid::Uuid::new_v4().simple()));
    let _ = tokio::fs::create_dir_all(conn.ctx.core.paths.tmp()).await;
    match tokio::fs::File::create(&path).await {
        Ok(file) => {
            conn.uploads.lock().await.insert(uid.clone(), Upload { path, file, received: 0, frame: frame_req });
            let _ = conn.out.send(frame("upload.ack", json!({ "uid": uid, "received": 0 }))).await;
        }
        Err(e) => {
            let _ = conn.out.send(frame("upload.error", json!({ "uid": uid, "message": e.to_string() }))).await;
        }
    }
}

pub(super) async fn upload_chunk(conn: &Arc<Conn>, d: &Value) {
    let uid = d["uid"].as_str().unwrap_or_default().to_string();
    let data = d["data"].as_str().and_then(|b| B64.decode(b).ok()).unwrap_or_default();
    let mut ups = conn.uploads.lock().await;
    let Some(u) = ups.get_mut(&uid) else { return };
    if d["offset"].as_u64() != Some(u.received) {
        let _ = conn.out.send(frame("upload.ack", json!({ "uid": uid, "received": u.received }))).await;
        return;
    }
    if let Err(e) = u.file.write_all(&data).await {
        let _ = conn.out.send(frame("upload.error", json!({ "uid": uid, "message": e.to_string() }))).await;
        return;
    }
    u.received += data.len() as u64;
    let _ = conn.out.send(frame("upload.ack", json!({ "uid": uid, "received": u.received }))).await;
}

pub(super) async fn upload_end(conn: &Arc<Conn>, d: &Value) {
    let uid = d["uid"].as_str().unwrap_or_default();
    let Some(mut u) = conn.uploads.lock().await.remove(uid) else { return };
    let _ = u.file.flush().await;
    drop(u.file);
    let Ok(file) = tokio::fs::File::open(&u.path).await else { return };
    u.frame.id = d["id"].as_str().unwrap_or(uid).to_string();
    let path = u.path.clone();
    let body = Body::from_stream(tokio_util::io::ReaderStream::new(file));
    let c = conn.clone();
    let f = u.frame;
    tokio::spawn(async move {
        dispatch::handle(c.router.clone(), f, body, c.out.clone(), c.acks.clone()).await;
        let _ = tokio::fs::remove_file(path).await;
    });
}
