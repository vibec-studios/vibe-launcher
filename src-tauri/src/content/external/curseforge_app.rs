use super::*;

// ------------------------------------------------------------------ CurseForge App

pub fn curseforge_roots() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(h) = dirs::home_dir() {
        v.push(h.join("curseforge").join("minecraft").join("Instances"));
    }
    if let Some(d) = dirs::document_dir() {
        v.push(d.join("Curse").join("Minecraft").join("Instances"));
    }
    v.into_iter().filter(|p| p.is_dir()).collect()
}

pub fn curseforge_one(dir: &Path) -> Option<Found> {
    let v: Value = serde_json::from_slice(&std::fs::read(dir.join("minecraftinstance.json")).ok()?).ok()?;
    let st = |x: Option<&Value>| x.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty());
    let name = st(v.get("name")).or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()))?;
    let mc = st(v.get("gameVersion")).or_else(|| st(v.get("baseModLoader").and_then(|b| b.get("minecraftVersion")))).unwrap_or_default();
    let loader = st(v.get("baseModLoader").and_then(|b| b.get("name"))).map(|id| loader_from_cf_id(&id, &mc)).unwrap_or_else(vanilla);
    let icon = st(v.get("profileImagePath")).map(PathBuf::from).filter(|p| p.is_file());
    let mut f = found(name, dir.to_path_buf(), dir, mc, loader, icon);
    f.settings = extsettings::curseforge(&v);
    f.info.last_played = st(v.get("lastPlayed")).and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok()).map(|d| d.timestamp_millis()).filter(|v| *v > 0);
    if let Some(mp) = v.get("installedModpack").filter(|m| !m.is_null()) {
        let pid = mp.get("addonID").and_then(|x| x.as_u64()).map(|x| x.to_string());
        let fid = mp.get("installedFile").and_then(|f| f.get("id")).and_then(|x| x.as_u64()).map(|x| x.to_string());
        if pid.is_some() {
            f.pack = Some(PackSource { kind: PackSourceKind::Curseforge, project_id: pid, version_id: fid, name: Some(f.info.name.clone()), version_name: None });
        }
    }
    if f.info.mc_version.is_empty() {
        f = with_guess(f);
    }
    Some(f)
}

pub(super) fn curseforge_scan(dir: &Path) -> Vec<Found> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten().filter_map(|e| curseforge_one(&e.path())).collect()
}
