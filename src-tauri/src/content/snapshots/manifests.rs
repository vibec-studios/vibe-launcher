use super::*;

// ------------------------------------------------------------------ Manifeste

pub(super) fn read_manifest(path: &Path) -> AppResult<Manifest> {
    let b = std::fs::read(path)?;
    Ok(serde_json::from_slice(&b)?)
}

pub(super) fn manifests(root: &Path, instance_id: &str) -> Vec<Manifest> {
    let Ok(rd) = std::fs::read_dir(snapshot_dir(root, instance_id)) else { return vec![] };
    let mut v: Vec<Manifest> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .filter_map(|p| match read_manifest(&p) {
            Ok(m) => Some(m),
            Err(e) => {
                tracing::warn!("Snapshot-Manifest {p:?} unlesbar: {e}");
                None
            }
        })
        .collect();
    v.sort_by(|a, b| b.created.cmp(&a.created).then(b.id.cmp(&a.id)));
    v
}

pub(super) fn load(root: &Path, instance_id: &str, snapshot_id: &str) -> AppResult<Manifest> {
    let p = snapshot_dir(root, instance_id).join(format!("{snapshot_id}.json"));
    if !p.exists() {
        return Err(AppError::NotFound("Snapshot".into()));
    }
    read_manifest(&p).map_err(|e| AppError::msg(format!("Snapshot ist beschädigt: {e}")))
}

/// Alle Objekte müssen vorhanden sein und die richtige Größe haben.
pub(super) fn verify(root: &Path, m: &Manifest) -> AppResult<()> {
    for f in m.files.iter().chain(&m.meta) {
        let ok = std::fs::metadata(object_path(root, &f.sha1)).is_ok_and(|md| md.len() == f.size);
        if !ok {
            return Err(AppError::msg(format!("Snapshot ist beschädigt: Inhalt von {} fehlt im Speicher", f.rel_path)));
        }
    }
    Ok(())
}

pub(super) fn write_atomic(target: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(p) = target.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = tmp_name(target);
    if let Err(e) = std::fs::write(&tmp, data).and_then(|_| std::fs::rename(&tmp, target)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// content.json für einen Teil-Snapshot zusammenführen: Einträge (`files`, `local`, `pinned`) der Ordner `prefixes`
/// kommen aus dem Snapshot, alle anderen bleiben wie aktuell. `unknown` (Hash-Cache) wird vereinigt. Generisch über
/// JSON, damit unbekannte Felder erhalten bleiben.
pub(super) fn merge_index(current: Option<&[u8]>, snap: Option<&[u8]>, prefixes: &[&str]) -> Vec<u8> {
    use serde_json::{Map, Value};
    let parse = |b: Option<&[u8]>| -> Map<String, Value> {
        b.and_then(|b| serde_json::from_slice::<Value>(b).ok()).and_then(|v| v.as_object().cloned()).unwrap_or_default()
    };
    let ours = |k: &str| prefixes.iter().any(|p| k.split('/').next() == Some(p));
    let mut cur = parse(current);
    let snap = parse(snap);
    for field in ["files", "local"] {
        let mut map: Map<String, Value> = cur.get(field).and_then(|v| v.as_object().cloned()).unwrap_or_default();
        map.retain(|k, _| !ours(k));
        if let Some(Value::Object(s)) = snap.get(field) {
            for (k, v) in s {
                if ours(k) {
                    map.insert(k.clone(), v.clone());
                }
            }
        }
        cur.insert(field.into(), Value::Object(map));
    }
    let mut pinned: Vec<Value> = cur.get("pinned").and_then(|v| v.as_array().cloned()).unwrap_or_default();
    pinned.retain(|v| !v.as_str().is_some_and(ours));
    if let Some(Value::Array(s)) = snap.get("pinned") {
        pinned.extend(s.iter().filter(|v| v.as_str().is_some_and(ours)).cloned());
    }
    cur.insert("pinned".into(), Value::Array(pinned));
    if let Some(Value::Object(s)) = snap.get("unknown") {
        let mut map: Map<String, Value> = cur.get("unknown").and_then(|v| v.as_object().cloned()).unwrap_or_default();
        for (k, v) in s {
            map.entry(k.clone()).or_insert_with(|| v.clone());
        }
        cur.insert("unknown".into(), Value::Object(map));
    }
    if !cur.contains_key("format") {
        if let Some(f) = snap.get("format") {
            cur.insert("format".into(), f.clone());
        }
    }
    serde_json::to_vec_pretty(&Value::Object(cur)).unwrap_or_default()
}

pub(crate) fn referenced(root: &Path, instance_id: &str) -> Vec<(String, u64)> {
    manifests(root, instance_id).into_iter().flat_map(|m| m.files.into_iter().chain(m.meta)).map(|f| (f.sha1, f.size)).collect()
}

pub(crate) async fn drop_instance(paths: &Paths, instance_id: &str) -> AppResult<()> {
    if !valid_name(instance_id) {
        return Err(AppError::Invalid("Instanz-ID".into()));
    }
    let _g = LOCK.lock().await;
    let root = backups_root(paths);
    let dir = snapshot_dir(&root, instance_id);
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        if dir.is_dir() {
            std::fs::remove_dir_all(&dir)?;
        }
        gc(&root)?;
        Ok(())
    })
    .await?
}
