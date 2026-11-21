use super::*;

pub(super) fn variant_of(s: &str) -> SkinVariant {
    SkinVariant::from_api(s)
}

/// Modrinth-Datenbank (Pfad einer *Kopie*) lesen.
pub fn read_modrinth_db(db: &Path) -> AppResult<Vec<RawFound>> {
    use rusqlite::OpenFlags;
    let c = rusqlite::Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| AppError::msg(format!("Modrinth-Datenbank nicht lesbar: {e}")))?;
    let has_order = c
        .prepare("SELECT 1 FROM pragma_table_info('custom_minecraft_skins') WHERE name = 'display_order'")
        .and_then(|mut s| s.exists([]))
        .unwrap_or(false);
    // Nur Skin-Tabellen + Benutzername (für den Namen); keine Token-Spalten
    let sql = format!(
        "SELECT s.texture_key, s.variant, s.cape_id, t.texture, u.username
         FROM custom_minecraft_skins s
         JOIN custom_minecraft_skin_textures t ON t.texture_key = s.texture_key
         LEFT JOIN minecraft_users u ON u.uuid = s.minecraft_user_uuid
         ORDER BY {}",
        if has_order { "s.display_order, s.rowid" } else { "s.rowid" }
    );
    let mut st = c.prepare(&sql).map_err(|e| AppError::msg(format!("Modrinth-Datenbank: Skin-Tabellen fehlen ({e})")))?;
    let rows = st
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Vec<u8>>(3)?, r.get::<_, Option<String>>(4)?))
        })
        .map_err(|e| AppError::msg(e.to_string()))?;
    let mut out = Vec::new();
    for (i, r) in rows.flatten().enumerate() {
        let (_key, variant, cape, png, user) = r;
        out.push(RawFound {
            name: Some(match user {
                Some(u) if !u.is_empty() => format!("{u} ({})", i + 1),
                _ => format!("Modrinth-Skin {}", i + 1),
            }),
            variant: variant_of(&variant),
            cape_id: cape.filter(|c| !c.trim().is_empty()),
            png: Some(png),
            url: None,
        });
    }
    Ok(out)
}

/// Kopie der Datenbank (mit WAL) anlegen, lesen, Kopie löschen.
pub(super) fn read_modrinth(db: &Path, tmp_root: &Path) -> AppResult<Vec<RawFound>> {
    let dir = tmp_root.join(format!("mr-skins-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir)?;
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _guard = Cleanup(dir.clone());
    let copy = dir.join("app.db");
    std::fs::copy(db, &copy).map_err(|e| AppError::msg(format!("Modrinth-Datenbank nicht lesbar: {e}")))?;
    for ext in ["-wal", "-shm"] {
        let mut p = db.as_os_str().to_owned();
        p.push(ext);
        let p = PathBuf::from(p);
        if p.is_file() {
            let _ = std::fs::copy(&p, dir.join(format!("app.db{ext}")));
        }
    }
    // Lesen auf der Kopie (darf dort WAL-Index anlegen); Original bleibt unberührt
    use rusqlite::OpenFlags;
    {
        // WAL der Kopie in die Kopie übernehmen, damit der Nur-Lese-Zugriff alle Daten sieht
        if let Ok(c) = rusqlite::Connection::open_with_flags(&copy, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX) {
            let _ = c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
        }
    }
    read_modrinth_db(&copy)
}

#[derive(Deserialize)]
pub(super) struct NoriskFile {
    #[serde(default)]
    pub(super) skins: Vec<NoriskSkin>,
}

#[derive(Deserialize)]
pub(super) struct NoriskSkin {
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) base64_data: String,
    #[serde(default)]
    pub(super) variant: String,
}

pub fn parse_norisk(b: &[u8]) -> AppResult<Vec<RawFound>> {
    let f: NoriskFile = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("NoRisk-Skinliste unlesbar: {e}")))?;
    Ok(f.skins
        .into_iter()
        .filter_map(|s| {
            let data = s.base64_data.rsplit(',').next().unwrap_or_default().trim().to_string();
            let png = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).ok()?;
            Some(RawFound { name: Some(s.name).filter(|n| !n.trim().is_empty()), variant: variant_of(&s.variant), cape_id: None, png: Some(png), url: None })
        })
        .collect())
}

/// Standard-Skins, die Lunar selbst einträgt (Steve/Alex).
pub(super) const LUNAR_DEFAULTS: &[&str] = &["1a4af718455d4aab528e7a61f86fa25e6a369d1768dcb13f7df319a713eb810b", "3b60a1f6d562f52aaebbf1434f1de147933a3affe0e764fa49ea057536623cd3"];

#[derive(Deserialize)]
pub(super) struct LunarEntry {
    #[serde(default, rename = "type")]
    pub(super) kind: Option<String>,
    #[serde(default)]
    pub(super) name: Option<String>,
}

pub fn parse_lunar(b: &[u8]) -> AppResult<Vec<RawFound>> {
    let m: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("Lunar-Skinliste unlesbar: {e}")))?;
    let mut out = Vec::new();
    for (url, v) in m {
        let u = url.trim();
        let host_ok = u.starts_with("http://textures.minecraft.net/texture/") || u.starts_with("https://textures.minecraft.net/texture/");
        if !host_ok {
            continue;
        }
        let hash = u.rsplit('/').next().unwrap_or_default();
        if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) || LUNAR_DEFAULTS.iter().any(|d| hash.eq_ignore_ascii_case(d)) {
            continue;
        }
        let e: LunarEntry = serde_json::from_value(v).unwrap_or(LunarEntry { kind: None, name: None });
        out.push(RawFound {
            name: e.name.filter(|n| !n.trim().is_empty()),
            variant: variant_of(e.kind.as_deref().unwrap_or("classic")),
            cape_id: None,
            png: None,
            url: Some(u.to_string()),
        });
    }
    Ok(out)
}

/// Rohdaten einer Quelle lesen (ohne Netz). `None` = App nicht installiert.
pub fn read_source(src: ImportSource, roots: &Roots, tmp_root: &Path) -> Option<(PathBuf, AppResult<Vec<RawFound>>)> {
    let path = roots.file(src)?;
    if !path.is_file() {
        return None;
    }
    let res = match src {
        ImportSource::Modrinth => read_modrinth(&path, tmp_root),
        ImportSource::Norisk => std::fs::read(&path).map_err(AppError::from).and_then(|b| parse_norisk(&b)),
        ImportSource::Lunar => std::fs::read(&path).map_err(AppError::from).and_then(|b| parse_lunar(&b)),
    };
    Some((path, res))
}
