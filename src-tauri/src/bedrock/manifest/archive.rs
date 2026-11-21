use super::*;

/// Höchstgrenzen gegen ZIP-Bomben.
pub const MAX_TOTAL: u64 = 8 * 1024 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 200_000;

/// Normalisierter, sicherer relativer Pfad eines Archiv-Eintrags (`None` = gefährlich -> ablehnen).
pub fn safe_rel(name: &str) -> Option<String> {
    let n = name.replace('\\', "/");
    if n.starts_with('/') || n.contains(':') || n.contains('\0') {
        return None;
    }
    let mut parts = Vec::new();
    for c in n.split('/') {
        match c {
            "" | "." => {}
            ".." => return None,
            c => parts.push(c),
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

/// Eine Datei im (ggf. verschachtelten) Archiv, bereits ausgelesen.
pub struct Entry {
    pub path: String,
    pub data: Vec<u8>,
}

/// Archiv vollständig und geprüft in den Speicher lesen. Gefährliche Pfade -> Fehler (ganzes Archiv
/// wird abgelehnt, damit kein Teil-Import entsteht).
pub fn read_zip(bytes: &[u8]) -> AppResult<Vec<Entry>> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| AppError::Invalid("Die Datei ist kein gültiges Bedrock-Archiv (ZIP).".into()))?;
    if z.len() > MAX_ENTRIES {
        return Err(AppError::Invalid("Archiv enthält zu viele Dateien".into()));
    }
    let mut total = 0u64;
    let mut out = Vec::new();
    for i in 0..z.len() {
        let mut f = z.by_index(i)?;
        if f.is_dir() {
            continue;
        }
        let Some(rel) = safe_rel(f.name()) else {
            return Err(AppError::Invalid(format!("Unsicherer Pfad im Archiv: {}", f.name())));
        };
        // Symlinks in ZIPs (Unix-Modus) nie übernehmen
        if f.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err(AppError::Invalid(format!("Verknüpfung im Archiv nicht erlaubt: {}", f.name())));
        }
        total = total.saturating_add(f.size());
        if total > MAX_TOTAL {
            return Err(AppError::Invalid("Archiv ist entpackt zu groß".into()));
        }
        let mut data = Vec::with_capacity(f.size().min(64 * 1024 * 1024) as usize);
        (&mut f).take(MAX_TOTAL).read_to_end(&mut data)?;
        out.push(Entry { path: rel, data });
    }
    Ok(out)
}

/// Gefundener Inhalt eines Archivs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Found {
    /// Pack, `root` = Präfix im Archiv ("" oder "ordner/"), `nested` = Pfad des inneren Archivs
    Pack { manifest: Manifest, root: String, nested: Option<String> },
    /// Welt (`level.dat`), `root` = Präfix
    World { name: String, root: String, nested: Option<String> },
}

pub(super) fn parent_prefix(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..=i].to_string(),
        None => String::new(),
    }
}

/// Inhalt eines Archivs bestimmen. Innere Archive (`.mcpack` in `.mcaddon`) werden eine Ebene tief
/// mitgelesen. Packs innerhalb von Welten/Vorlagen gehören zur Welt und werden nicht einzeln gemeldet.
pub fn analyze(entries: &[Entry]) -> AppResult<Vec<Found>> {
    analyze_at(entries, None, 0)
}

pub(super) fn analyze_at(entries: &[Entry], nested: Option<&str>, depth: u32) -> AppResult<Vec<Found>> {
    let mut found = Vec::new();
    // Welten: Ordner mit level.dat (ohne world_template-Manifest)
    let mut world_roots: Vec<String> = entries.iter().filter(|e| e.path == "level.dat" || e.path.ends_with("/level.dat")).map(|e| parent_prefix(&e.path)).collect();
    world_roots.sort_by_key(|r| r.len());
    world_roots.dedup();
    // Äußerste zuerst; innere Welten (Backups in Welten) ignorieren
    let mut outer_worlds: Vec<String> = Vec::new();
    for r in world_roots {
        if !outer_worlds.iter().any(|o| r.starts_with(o.as_str())) {
            outer_worlds.push(r);
        }
    }
    let lang_for = |root: &str| -> Option<String> {
        entries.iter().find(|e| e.path == format!("{root}texts/en_US.lang")).map(|e| String::from_utf8_lossy(&e.data).to_string())
    };
    let mut manifests: Vec<&Entry> = entries.iter().filter(|e| e.path == "manifest.json" || e.path.ends_with("/manifest.json")).collect();
    manifests.sort_by_key(|e| e.path.len());
    let mut pack_roots: Vec<String> = Vec::new();
    for m in manifests {
        let root = parent_prefix(&m.path);
        // Innerhalb einer Welt (außer die Welt ist selbst eine Vorlage mit Manifest auf ihrer Ebene)?
        if outer_worlds.iter().any(|w| root.starts_with(w.as_str()) && root != *w) {
            continue;
        }
        // Innerhalb eines schon gefundenen Packs (z. B. Unterpacks)?
        if pack_roots.iter().any(|p| root.starts_with(p.as_str())) {
            continue;
        }
        match parse(&m.data, lang_for(&root).as_deref()) {
            Ok(manifest) => {
                if manifest.kind == PackKind::WorldTemplate {
                    outer_worlds.retain(|w| *w != root);
                }
                pack_roots.push(root.clone());
                found.push(Found::Pack { manifest, root, nested: nested.map(str::to_string) });
            }
            Err(e) => tracing::debug!("Manifest {} übersprungen: {e}", m.path),
        }
    }
    for w in outer_worlds {
        let name = entries
            .iter()
            .find(|e| e.path == format!("{w}levelname.txt"))
            .map(|e| strip_format(String::from_utf8_lossy(&e.data).lines().next().unwrap_or("")))
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| "Welt".into());
        found.push(Found::World { name, root: w, nested: nested.map(str::to_string) });
    }
    if depth == 0 {
        for e in entries {
            let lower = e.path.to_ascii_lowercase();
            if [".mcpack", ".mcaddon", ".mcworld", ".mctemplate", ".zip"].iter().any(|x| lower.ends_with(x)) {
                if pack_roots.iter().any(|p| e.path.starts_with(p.as_str())) {
                    continue;
                }
                match read_zip(&e.data) {
                    Ok(inner) => found.extend(analyze_at(&inner, Some(&e.path), depth + 1)?),
                    Err(err) => tracing::debug!("Inneres Archiv {} übersprungen: {err}", e.path),
                }
            }
        }
    }
    Ok(found)
}

/// Dateien eines gefundenen Inhalts (relativ zu dessen Wurzel).
pub fn files_of<'a>(entries: &'a [Entry], root: &str) -> Vec<(&'a str, &'a [u8])> {
    entries.iter().filter_map(|e| e.path.strip_prefix(root).filter(|r| !r.is_empty()).map(|r| (r, e.data.as_slice()))).collect()
}
