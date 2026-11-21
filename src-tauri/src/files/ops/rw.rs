use super::*;

pub fn read(r: &FileRoot, rel: &str) -> AppResult<FileContent> {
    let p = r.sandbox.existing(rel, false)?;
    let meta = std::fs::metadata(&p.abs)?;
    if !meta.is_file() {
        return Err(invalid("Das ist keine Datei"));
    }
    let kind = kind_of(&p.rel, &p.abs, meta.len());
    let log = is_log(&p.rel);
    let mut f = FileContent {
        language: language_of(&p.rel),
        has_backup: has_backup(r, &p.rel),
        size: meta.len(),
        modified: mtime_ms(&meta),
        content: String::new(),
        kind,
        readonly: false,
        readonly_reason: None,
        path: p.rel,
    };
    if kind != "text" {
        f.readonly = true;
        f.readonly_reason = Some(if kind == "image" { "image" } else { "binary" });
        return Ok(f);
    }
    let limit = if log { MAX_LOG_VIEW } else { MAX_EDIT };
    if meta.len() > limit {
        f.readonly = true;
        f.readonly_reason = Some("too_large");
        return Ok(f);
    }
    let bytes = std::fs::read(&p.abs)?;
    match String::from_utf8(bytes) {
        Ok(s) => f.content = s.strip_prefix(BOM).map(str::to_string).unwrap_or(s),
        Err(e) => {
            // Nur ansehen – verlustbehaftet zurückschreiben wäre gefährlich
            f.content = String::from_utf8_lossy(e.as_bytes()).into_owned();
            f.readonly = true;
            f.readonly_reason = Some("encoding");
        }
    }
    if log && !f.readonly {
        f.readonly = true;
        f.readonly_reason = Some("log");
    }
    Ok(f)
}

pub(super) static WRITE_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

pub(super) fn check_writable_text(p: &Resolved, size_hint: u64) -> AppResult<()> {
    if is_log(&p.rel) {
        return Err(invalid("Logs können nur angesehen werden"));
    }
    if p.exists && kind_of(&p.rel, &p.abs, size_hint) != "text" {
        return Err(invalid("Dieser Dateityp kann nicht bearbeitet werden"));
    }
    Ok(())
}

pub fn write(r: &FileRoot, rel: &str, content: &str) -> AppResult<FileContent> {
    let p = r.sandbox.resolve(rel, false)?;
    if !p.exists {
        return Err(AppError::NotFound(p.rel));
    }
    let meta = std::fs::metadata(&p.abs)?;
    if !meta.is_file() {
        return Err(invalid("Das ist keine Datei"));
    }
    check_writable_text(&p, meta.len())?;
    if content.len() as u64 > MAX_EDIT {
        return Err(invalid("Der Inhalt ist größer als 2 MB"));
    }
    let _g = WRITE_LOCK.lock();
    let old = std::fs::read(&p.abs)?;
    let mut data = content.strip_prefix(BOM).unwrap_or(content).to_string();
    let old_s = std::str::from_utf8(&old).map_err(|_| invalid("Die Datei ist nicht UTF-8-kodiert und kann hier nicht bearbeitet werden"))?;
    // Zeilenenden und BOM der Originaldatei beibehalten
    if old_s.contains("\r\n") && !data.contains('\r') {
        data = data.replace('\n', "\r\n");
    }
    if old_s.starts_with(BOM) {
        data.insert(0, BOM);
    }
    if old.as_slice() != data.as_bytes() {
        // Leere Ausgangsdatei (z. B. gerade angelegt) braucht keine Sicherung
        if !old.is_empty() {
            add_backup(r, &p.rel, &old)?;
        }
        write_atomic(&p.abs, data.as_bytes())?;
    }
    drop(_g);
    read(r, &p.rel)
}

/// Neueste Sicherung zurückspielen; der aktuelle Inhalt wird vorher selbst gesichert (rückgängig machbar).
pub fn restore(r: &FileRoot, rel: &str) -> AppResult<FileContent> {
    let p = r.sandbox.resolve(rel, false)?;
    check_writable_text(&p, 0)?;
    let _g = WRITE_LOCK.lock();
    let latest = list_backups(r, &p.rel).pop().ok_or_else(|| AppError::NotFound("Sicherung für diese Datei".into()))?;
    let data = std::fs::read(&latest)?;
    let cur = match std::fs::read(&p.abs) {
        Ok(cur) => Some(cur),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    // Erst die zurückgespielte Sicherung entfernen, dann die aktuelle Fassung sichern –
    // so verdrängt die neue Sicherung keine ältere (Anzahl bleibt gleich).
    std::fs::remove_file(&latest)?;
    let res = (|| -> AppResult<()> {
        if let Some(cur) = cur.as_ref().filter(|c| **c != data) {
            add_backup(r, &p.rel, cur)?;
        }
        write_atomic(&p.abs, &data)
    })();
    if let Err(e) = res {
        // Inhalt der Sicherung nicht verlieren
        let _ = add_backup(r, &p.rel, &data);
        return Err(e);
    }
    drop(_g);
    read(r, &p.rel)
}

/// Bild als data-URL (Vorschau).
pub fn image_data_url(r: &FileRoot, rel: &str) -> AppResult<String> {
    use base64::Engine;
    let p = r.sandbox.existing(rel, false)?;
    if !is_image(&p.rel) {
        return Err(invalid("Keine Bilddatei"));
    }
    let meta = std::fs::metadata(&p.abs)?;
    if !meta.is_file() || meta.len() > MAX_IMAGE {
        return Err(invalid("Das Bild ist zu groß für die Vorschau"));
    }
    let bytes = std::fs::read(&p.abs)?;
    let mime = match ext_of(&p.rel).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/png",
    };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}
