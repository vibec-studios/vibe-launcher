use super::*;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BridgeAccount {
    pub uuid: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BridgeActive {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub library_id: Option<String>,
    pub sha1: String,
    pub variant: SkinVariant,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BridgeInput {
    pub account: Option<BridgeAccount>,
    pub blocked: Option<&'static str>,
    pub active_sha1: Option<(String, SkinVariant)>,
}

pub fn safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub(super) fn atomic_write(path: &Path, data: &[u8]) -> AppResult<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    std::fs::write(&tmp, data)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

pub(super) fn file_sha1(p: &Path) -> Option<String> {
    std::fs::read(p).ok().map(|b| hex::encode(Sha1::digest(b)))
}

pub fn write_skin_bridge(vibe_dir: &Path, library: &[BridgeSkin], input: &BridgeInput, now_secs: i64) -> AppResult<()> {
    let skins_dir = vibe_dir.join("skins");
    std::fs::create_dir_all(&skins_dir)?;
    let mut entries = Vec::new();
    let mut keep: HashSet<String> = HashSet::new();
    for s in library.iter().filter(|s| safe_id(&s.id)).take(MAX_SKINS) {
        let file = format!("{}.png", s.id);
        let dest = skins_dir.join(&file);
        if file_sha1(&dest).as_deref() != Some(s.sha1.as_str()) {
            let Ok(bytes) = std::fs::read(&s.path) else { continue };
            atomic_write(&dest, &bytes)?;
        }
        keep.insert(file.clone());
        let name: String = s.name.chars().take(NAME_MAX).collect();
        let mut e = json!({ "id": s.id, "name": name, "variant": s.variant.api(), "file": file, "sha1": s.sha1, "added_at": s.added_at });
        if let Some(c) = &s.cape_id {
            e["cape_id"] = Value::String(c.clone());
        }
        entries.push(e);
    }
    let mut doc = json!({ "schema": 1, "updated_at": now_secs, "can_change": input.blocked.is_none(), "skins": entries });
    if let Some(a) = &input.account {
        doc["account"] = serde_json::to_value(a)?;
    }
    if let Some(r) = input.blocked {
        doc["reason"] = Value::String(r.into());
    }
    if let Some((sha, variant)) = &input.active_sha1 {
        let library_id = library.iter().find(|s| s.sha1.eq_ignore_ascii_case(sha)).map(|s| s.id.clone()).filter(|id| safe_id(id));
        doc["active"] = serde_json::to_value(BridgeActive { library_id, sha1: sha.clone(), variant: *variant })?;
    }
    let mut data = serde_json::to_vec_pretty(&doc)?;
    data.push(b'\n');
    atomic_write(&vibe_dir.join(SKINS_FILE), &data)?;
    if let Ok(rd) = std::fs::read_dir(&skins_dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.ends_with(".png") && !keep.contains(&n) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    Ok(())
}
