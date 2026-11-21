use super::*;

pub(super) fn parse_pack_list(v: &str) -> Option<Vec<String>> {
    serde_json::from_str::<Vec<String>>(v.trim()).ok()
}

/// Pack-Auswahl in eine options.txt schreiben. Gewählte Datei-Packs kommen auch in `incompatibleResourcePacks`,
/// damit Minecraft sie in Versionen, für die sie nicht gemacht sind, trotzdem lädt (und nur markiert) statt sie
/// still abzuwählen. Minecraft räumt kompatible Packs dort selbst wieder aus.
pub(super) fn write_packs(opts: &mut Vec<(String, String)>, packs: &[String]) {
    let mut incompat = opts.iter().find(|(k, _)| k == "incompatibleResourcePacks").and_then(|(_, v)| parse_pack_list(v)).unwrap_or_default();
    for p in packs.iter().filter(|p| p.starts_with("file/")) {
        if !incompat.contains(p) {
            incompat.push(p.clone());
        }
    }
    set_opt(opts, "resourcePacks", serde_json::to_string(packs).unwrap_or_else(|_| "[]".into()));
    set_opt(opts, "incompatibleResourcePacks", serde_json::to_string(&incompat).unwrap_or_else(|_| "[]".into()));
}

/// Packs, die Minecraft beim letzten Start selbst aus der Auswahl entfernt hat (laut `logs/latest.log`:
/// „Removed resource pack X from options because …“). Nur ein Log aus dieser Sitzung zählt.
pub(super) fn dropped_by_game(game_dir: &Path, since: Option<i64>) -> HashSet<String> {
    let p = game_dir.join("logs").join("latest.log");
    let Ok(m) = std::fs::metadata(&p) else { return HashSet::new() };
    let mtime = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
    let min = since.map(|s| s - 60_000).unwrap_or_else(|| crate::util::now_ms() - 12 * 3_600_000);
    if mtime < min || m.len() > 64 * 1024 * 1024 {
        return HashSet::new();
    }
    let Ok(b) = std::fs::read(&p) else { return HashSet::new() };
    parse_dropped(&String::from_utf8_lossy(&b))
}

pub(super) fn parse_dropped(log: &str) -> HashSet<String> {
    const A: &str = "Removed resource pack ";
    const B: &str = " from options because";
    log.lines()
        .filter_map(|l| {
            let s = l.find(A)? + A.len();
            let e = l[s..].find(B)? + s;
            Some(l[s..e].to_string())
        })
        .collect()
}

/// Pack-Auswahl nach dem Spielen ins Master-Profil übernehmen.
pub(super) fn pull_packs(master: Option<&[String]>, applied: Option<&[String]>, after: &[String], protected: impl Fn(&String) -> bool) -> Vec<String> {
    let mut after = after.to_vec();
    if let Some(ap) = applied {
        // Was das Spiel selbst entfernt hat (fehlt hier), bleibt für die anderen Instanzen gewählt
        reinsert(&mut after, ap, |x| protected(x));
    }
    merge_list(master.unwrap_or(&[]), applied.unwrap_or(&[]), &after)
}
