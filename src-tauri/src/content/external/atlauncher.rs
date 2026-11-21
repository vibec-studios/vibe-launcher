use super::*;

// ------------------------------------------------------------------ ATLauncher

pub fn atlauncher_roots() -> Vec<PathBuf> {
    let Some(d) = dirs::data_dir() else { return vec![] };
    [d.join("ATLauncher").join("instances")].into_iter().filter(|p| p.is_dir()).collect()
}

pub fn atlauncher_one(dir: &Path) -> Option<Found> {
    let v: Value = serde_json::from_slice(&std::fs::read(dir.join("instance.json")).ok()?).ok()?;
    let l = v.get("launcher")?;
    let st = |x: Option<&Value>| x.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty());
    let name = st(l.get("name")).or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()))?;
    let mc = st(v.get("id")).filter(|s| s.chars().next().is_some_and(|c| c.is_ascii_digit())).or_else(|| st(l.get("minecraftVersion"))).unwrap_or_default();
    let lv = l.get("loaderVersion");
    let loader = lv.and_then(|lv| st(lv.get("type"))).map(|t| parse_loader(&t, lv.and_then(|lv| st(lv.get("version"))))).unwrap_or_else(vanilla);
    let icon = [dir.join("instance.png")].into_iter().find(|p| p.is_file());
    let mut f = found(name, dir.to_path_buf(), dir, mc, loader, icon);
    f.info.last_played = l.get("lastPlayed").and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.timestamp_millis()))).filter(|v| *v > 0).map(ms);
    f.info.play_time_secs = l.get("totalPlayTime").and_then(|x| x.as_u64()).filter(|v| *v > 0);
    f.settings = extsettings::atlauncher(l, extsettings::atlauncher_global(dir).as_ref());
    f.pack = extsettings::atlauncher_pack(l);
    if f.info.mc_version.is_empty() {
        f = with_guess(f);
    }
    Some(f)
}

pub(super) fn atlauncher_scan(dir: &Path) -> Vec<Found> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten().filter_map(|e| atlauncher_one(&e.path())).collect()
}
