use super::*;

// ------------------------------------------------------------------ Modrinth App

pub fn modrinth_roots() -> Vec<PathBuf> {
    let Some(d) = dirs::data_dir() else { return vec![] };
    ["ModrinthApp", "com.modrinth.theseus"].iter().map(|n| d.join(n)).filter(|p| p.join("app.db").is_file() || p.join("profiles").is_dir()).collect()
}

/// Datenbank samt WAL in den Cache kopieren (nur bei Änderung) und öffnen.
pub(super) fn open_db_copy(root: &Path, tmp: &Path) -> Option<rusqlite::Connection> {
    open_db_copy_named(root, tmp, "modrinth-db")
}

/// `<root>/app.db` (+ `-wal`/`-shm`) nach `tmp/<prefix>-<hash>/` kopieren und die Kopie öffnen.
pub(crate) fn open_db_copy_named(root: &Path, tmp: &Path, prefix: &str) -> Option<rusqlite::Connection> {
    let db = root.join("app.db");
    if !db.is_file() {
        return None;
    }
    let stamp_of = |p: &Path| std::fs::metadata(p).ok().map(|m| format!("{}:{:?}", m.len(), m.modified().ok())).unwrap_or_default();
    let stamp = format!("scrubbed-v1|{}|{}", stamp_of(&db), stamp_of(&root.join("app.db-wal")));
    let key = hex::encode(<sha1::Sha1 as sha1::Digest>::digest(norm(&s(root)).as_bytes()));
    let dir = tmp.join(format!("{prefix}-{}", &key[..12]));
    let stamp_file = dir.join("stamp");
    if std::fs::read_to_string(&stamp_file).ok().as_deref() != Some(stamp.as_str()) {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).ok()?;
        for ext in ["", "-wal", "-shm"] {
            let src = root.join(format!("app.db{ext}"));
            if src.is_file() {
                if let Err(e) = std::fs::copy(&src, dir.join(format!("app.db{ext}"))) {
                    tracing::warn!("Modrinth-DB nicht kopierbar ({}): {e}", src.display());
                    if ext.is_empty() {
                        return None;
                    }
                }
            }
        }
        if let Ok(c) = rusqlite::Connection::open(dir.join("app.db")) {
            scrub_secrets(&c);
        }
        let _ = std::fs::write(&stamp_file, &stamp);
    }
    // Kopie gehört uns – normal öffnen (WAL wird dabei in die Kopie übernommen)
    rusqlite::Connection::open(dir.join("app.db")).map_err(|e| tracing::warn!("Modrinth-DB nicht lesbar: {e}")).ok()
}

pub(super) const SECRET_TABLES: &[&str] = &["minecraft_users", "minecraft_device_tokens", "modrinth_users", "accounts", "credentials"];

pub(super) fn scrub_secrets(c: &rusqlite::Connection) {
    let _ = c.execute_batch("PRAGMA secure_delete = ON;");
    for t in SECRET_TABLES {
        if has_table(c, t) {
            let _ = c.execute(&format!("DELETE FROM \"{t}\""), []);
        }
    }
    let _ = c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
}

#[derive(Debug, Default, Clone)]
pub(super) struct MrRow {
    pub(super) path: String,
    pub(super) name: String,
    pub(super) icon_path: Option<String>,
    pub(super) last_played: Option<i64>,
    pub(super) played: i64,
    pub(super) game_version: Option<String>,
    pub(super) loader: Option<String>,
    pub(super) loader_version: Option<String>,
    pub(super) project_id: Option<String>,
    pub(super) version_id: Option<String>,
}

pub(super) fn has_table(c: &rusqlite::Connection, t: &str) -> bool {
    c.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [t], |r| r.get::<_, i64>(0)).unwrap_or(0) > 0
}

pub(super) fn columns(c: &rusqlite::Connection, t: &str) -> Vec<String> {
    let Ok(mut st) = c.prepare(&format!("PRAGMA table_info({t})")) else { return vec![] };
    st.query_map([], |r| r.get::<_, String>(1)).map(|it| it.flatten().collect()).unwrap_or_default()
}

pub(super) fn mr_rows(c: &rusqlite::Connection) -> Vec<MrRow> {
    let col = |cols: &[String], name: &str, fallback: &str| if cols.iter().any(|c| c == name) { name.to_string() } else { fallback.to_string() };
    // Neues Schema: instances + instance_content_sets (+ instance_links)
    if has_table(c, "instances") && has_table(c, "instance_content_sets") {
        let ic = columns(c, "instances");
        let links = has_table(c, "instance_links");
        let sql = format!(
            "SELECT i.path, i.name, {icon}, {lp}, {sp} + {rp}, s.game_version, s.loader, s.loader_version, {pid}, {vid}
             FROM instances i LEFT JOIN instance_content_sets s ON s.id = i.applied_content_set_id {join}",
            icon = col(&ic, "icon_path", "NULL"),
            lp = col(&ic, "last_played", "NULL"),
            sp = col(&ic, "submitted_time_played", "0"),
            rp = col(&ic, "recent_time_played", "0"),
            pid = if links { "l.modrinth_project_id" } else { "NULL" },
            vid = if links { "l.modrinth_version_id" } else { "NULL" },
            join = if links { "LEFT JOIN instance_links l ON l.instance_id = i.id AND l.link_kind = 'modrinth_modpack'" } else { "" },
        );
        if let Ok(mut st) = c.prepare(&sql) {
            let rows = st.query_map([], |r| {
                Ok(MrRow {
                    path: r.get(0)?,
                    name: r.get(1)?,
                    icon_path: r.get(2)?,
                    last_played: r.get(3)?,
                    played: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    game_version: r.get(5)?,
                    loader: r.get(6)?,
                    loader_version: r.get(7)?,
                    project_id: r.get(8)?,
                    version_id: r.get(9)?,
                })
            });
            match rows {
                Ok(it) => return it.flatten().collect(),
                Err(e) => tracing::warn!("Modrinth-DB (instances): {e}"),
            }
        }
    }
    // Älteres Schema: profiles
    if has_table(c, "profiles") {
        let pc = columns(c, "profiles");
        let sql = format!(
            "SELECT path, name, {icon}, {lp}, {sp} + {rp}, {gv}, {ml}, {mlv}, {pid}, {vid} FROM profiles",
            icon = col(&pc, "icon_path", "NULL"),
            lp = col(&pc, "last_played", "NULL"),
            sp = col(&pc, "submitted_time_played", "0"),
            rp = col(&pc, "recent_time_played", "0"),
            gv = col(&pc, "game_version", "NULL"),
            ml = col(&pc, "mod_loader", "NULL"),
            mlv = col(&pc, "mod_loader_version", "NULL"),
            pid = col(&pc, "linked_project_id", "NULL"),
            vid = col(&pc, "linked_version_id", "NULL"),
        );
        if let Ok(mut st) = c.prepare(&sql) {
            if let Ok(it) = st.query_map([], |r| {
                Ok(MrRow {
                    path: r.get(0)?,
                    name: r.get(1)?,
                    icon_path: r.get(2)?,
                    last_played: r.get(3)?,
                    played: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    game_version: r.get(5)?,
                    loader: r.get(6)?,
                    loader_version: r.get(7)?,
                    project_id: r.get(8)?,
                    version_id: r.get(9)?,
                })
            }) {
                return it.flatten().collect();
            }
        }
    }
    vec![]
}

/// Sehr alte Modrinth-App: `profile.json` je Profilordner.
pub(super) fn mr_profile_json(dir: &Path) -> Option<MrRow> {
    let v: Value = serde_json::from_slice(&std::fs::read(dir.join("profile.json")).ok()?).ok()?;
    let m = v.get("metadata")?;
    let st = |v: Option<&Value>| v.and_then(|x| x.as_str()).map(str::to_string);
    let linked = m.get("linked_data");
    Some(MrRow {
        path: dir.file_name()?.to_string_lossy().to_string(),
        name: st(m.get("name")).unwrap_or_default(),
        icon_path: st(m.get("icon")),
        last_played: m.get("last_played").and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.timestamp()))),
        played: v.get("submitted_time_played").and_then(|x| x.as_i64()).unwrap_or(0) + v.get("recent_time_played").and_then(|x| x.as_i64()).unwrap_or(0),
        game_version: st(m.get("game_version")),
        loader: st(m.get("loader")),
        loader_version: m.get("loader_version").and_then(|lv| lv.get("id").and_then(|x| x.as_str()).map(str::to_string).or_else(|| lv.as_str().map(str::to_string))),
        project_id: linked.and_then(|l| st(l.get("project_id"))),
        version_id: linked.and_then(|l| st(l.get("version_id"))),
    })
}

pub(super) fn modrinth_scan(root: &Path, tmp: &Path) -> Vec<Found> {
    let conn = open_db_copy(root, tmp);
    let rows: Vec<MrRow> = conn.as_ref().map(mr_rows).unwrap_or_default();
    // Eigener Datenordner (Einstellung "custom_dir")
    let custom: Option<PathBuf> = conn
        .as_ref()
        .filter(|c| columns(c, "settings").iter().any(|x| x == "custom_dir"))
        .and_then(|c| c.query_row("SELECT custom_dir FROM settings LIMIT 1", [], |r| r.get::<_, Option<String>>(0)).ok().flatten())
        .map(PathBuf::from)
        .filter(|p| p.join("profiles").is_dir());
    let base = custom.unwrap_or_else(|| root.to_path_buf());
    let settings: HashMap<String, ExtSettings> = conn.as_ref().map(extsettings::modrinth_all).unwrap_or_default();
    let by_path: HashMap<String, MrRow> = rows.into_iter().map(|r| (r.path.to_lowercase(), r)).collect();
    let Ok(rd) = std::fs::read_dir(base.join("profiles")) else { return vec![] };
    let dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    // Parallel auswerten (Icons lesen, ggf. Mods für die Schätzung öffnen)
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
    let chunk = dirs.len().div_ceil(n).max(1);
    std::thread::scope(|sc| {
        let handles: Vec<_> = dirs.chunks(chunk).map(|c| sc.spawn(|| c.iter().map(|d| modrinth_profile(d, &by_path, &settings)).collect::<Vec<_>>())).collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

pub(super) fn modrinth_profile(dir: &Path, by_path: &HashMap<String, MrRow>, settings: &HashMap<String, ExtSettings>) -> Found {
    let mut f = modrinth_profile_inner(dir, by_path);
    let key = dir.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    f.settings = match settings.get(&key) {
        Some(s) => s.clone(),
        None => std::fs::read(dir.join("profile.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).map(|v| extsettings::modrinth_profile_json(&v)).unwrap_or_default(),
    };
    f
}

pub(super) fn modrinth_profile_inner(dir: &Path, by_path: &HashMap<String, MrRow>) -> Found {
    let dir = dir.to_path_buf();
    let folder = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    {
        let row = by_path.get(&folder.to_lowercase()).cloned().or_else(|| mr_profile_json(&dir));
        match row {
            Some(r) => {
                let loader = parse_loader(r.loader.as_deref().unwrap_or("vanilla"), r.loader_version.clone());
                let icon = r.icon_path.as_ref().map(PathBuf::from).filter(|p| p.is_file());
                let mut f = found(if r.name.trim().is_empty() { folder.clone() } else { r.name.clone() }, dir.clone(), &dir, r.game_version.clone().unwrap_or_default(), loader, icon);
                f.info.last_played = r.last_played.filter(|v| *v > 0).map(ms);
                f.info.play_time_secs = Some(r.played.max(0) as u64).filter(|v| *v > 0);
                if let Some(pid) = r.project_id.clone() {
                    f.pack = Some(PackSource { kind: PackSourceKind::Modrinth, project_id: Some(pid), version_id: r.version_id.clone(), name: Some(f.info.name.clone()), version_name: None });
                }
                if f.info.mc_version.is_empty() {
                    with_guess(f)
                } else {
                    f
                }
            }
            None => with_guess(found(folder.clone(), dir.clone(), &dir, String::new(), vanilla(), None)),
        }
    }
}
