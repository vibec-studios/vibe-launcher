//! `manifest.json` von Bedrock-Packs lesen (tolerant: Kommentare, nachgestellte Kommas, Versionen als
//! Liste oder Text) und Archive (`.mcpack`, `.mcaddon`, `.mcworld`, `.mctemplate`) untersuchen.
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::io::Read;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PackKind {
    Resource,
    Behavior,
    Skin,
    WorldTemplate,
}

impl PackKind {
    /// Zielordner unter `com.mojang`.
    pub fn folder(&self) -> &'static str {
        match self {
            PackKind::Resource => "resource_packs",
            PackKind::Behavior => "behavior_packs",
            PackKind::Skin => "skin_packs",
            PackKind::WorldTemplate => "world_templates",
        }
    }
    pub fn all() -> [PackKind; 4] {
        [PackKind::Resource, PackKind::Behavior, PackKind::Skin, PackKind::WorldTemplate]
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Manifest {
    pub name: String,
    pub description: String,
    pub uuid: String,
    /// z. B. `[1, 2, 0]`
    pub version: Vec<u64>,
    pub kind: PackKind,
    /// Mindestversion des Spiels, falls angegeben
    pub min_engine: Option<String>,
    /// Typen aller Module (`resources`, `data`, `script` …)
    pub modules: Vec<String>,
}

impl Manifest {
    pub fn version_string(&self) -> String {
        self.version.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(".")
    }
}

/// Kommentare (`//`, `/* */`) und nachgestellte Kommas entfernen – Bedrock akzeptiert beides.
pub fn relax_json(s: &str) -> String {
    let s = s.trim_start_matches('\u{feff}');
    let b: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let mut in_str = false;
    while i < b.len() {
        let c = b[i];
        if in_str {
            out.push(c);
            if c == '\\' && i + 1 < b.len() {
                out.push(b[i + 1]);
                i += 2;
                continue;
            }
            if c == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match c {
            '"' => {
                in_str = true;
                out.push(c);
            }
            '/' if b.get(i + 1) == Some(&'/') => {
                while i < b.len() && b[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            '/' if b.get(i + 1) == Some(&'*') => {
                i += 2;
                while i + 1 < b.len() && !(b[i] == '*' && b[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
                continue;
            }
            ',' => {
                // Komma direkt vor } oder ] weglassen
                let mut j = i + 1;
                while j < b.len() && b[j].is_whitespace() {
                    j += 1;
                }
                if !matches!(b.get(j), Some('}') | Some(']')) {
                    out.push(c);
                }
            }
            _ => out.push(c),
        }
        i += 1;
    }
    out
}

fn parse_version(v: Option<&serde_json::Value>) -> Vec<u64> {
    match v {
        Some(serde_json::Value::Array(a)) => a.iter().map(|x| x.as_u64().unwrap_or(0)).collect(),
        Some(serde_json::Value::String(s)) => s.split(['.', '-', '+']).take(3).map(|p| p.parse().unwrap_or(0)).collect(),
        _ => vec![0, 0, 0],
    }
}

/// `§`-Formatcodes entfernen.
pub fn strip_format(s: &str) -> String {
    let mut out = String::new();
    let mut skip = false;
    for c in s.chars() {
        if skip {
            skip = false;
            continue;
        }
        if c == '§' {
            skip = true;
            continue;
        }
        out.push(c);
    }
    out.trim().to_string()
}

/// `manifest.json` auswerten. `lang`: Inhalt von `texts/en_US.lang` (für Namen wie `pack.name`).
pub fn parse(bytes: &[u8], lang: Option<&str>) -> AppResult<Manifest> {
    let text = String::from_utf8_lossy(bytes);
    let v: serde_json::Value = serde_json::from_str(&relax_json(&text)).map_err(|e| AppError::Invalid(format!("manifest.json ist kein gültiges JSON: {e}")))?;
    let header = v.get("header").ok_or_else(|| AppError::Invalid("manifest.json ohne „header“".into()))?;
    let uuid = header.get("uuid").and_then(|x| x.as_str()).unwrap_or("").trim().to_ascii_lowercase();
    if uuid.is_empty() {
        return Err(AppError::Invalid("manifest.json ohne UUID".into()));
    }
    let resolve = |key: &str| -> String {
        let raw = header.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let looks_like_key = !raw.is_empty() && !raw.contains(' ') && raw.contains('.');
        if looks_like_key {
            if let Some(l) = lang {
                for line in l.lines() {
                    if let Some((k, val)) = line.split_once('=') {
                        if k.trim() == raw {
                            // Kommentare hinter dem Wert (`\t##`) abschneiden
                            let val = val.split("\t#").next().unwrap_or(val);
                            return strip_format(val);
                        }
                    }
                }
            }
        }
        strip_format(&raw)
    };
    let modules: Vec<String> = v
        .get("modules")
        .and_then(|m| m.as_array())
        .map(|a| a.iter().filter_map(|m| m.get("type").and_then(|t| t.as_str()).map(|t| t.to_ascii_lowercase())).collect())
        .unwrap_or_default();
    let has = |t: &str| modules.iter().any(|m| m == t);
    let kind = if has("world_template") {
        PackKind::WorldTemplate
    } else if has("skin_pack") {
        PackKind::Skin
    } else if has("data") || has("script") || has("javascript") || has("client_data") {
        PackKind::Behavior
    } else if has("resources") {
        PackKind::Resource
    } else {
        return Err(AppError::Invalid("Unbekannter Pack-Typ (keine bekannten Module in manifest.json)".into()));
    };
    let min_engine = header.get("min_engine_version").map(|x| parse_version(Some(x))).filter(|v| !v.is_empty()).map(|v| v.iter().map(|n| n.to_string()).collect::<Vec<_>>().join("."));
    let mut name = resolve("name");
    if name.is_empty() {
        name = "Unbenanntes Pack".into();
    }
    Ok(Manifest { name, description: resolve("description"), uuid, version: parse_version(header.get("version")), kind, min_engine, modules })
}

// ------------------------------------------------------------------ Archive

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

fn parent_prefix(path: &str) -> String {
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

fn analyze_at(entries: &[Entry], nested: Option<&str>, depth: u32) -> AppResult<Vec<Found>> {
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

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;

    pub fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let o = zip::write::SimpleFileOptions::default();
            for (n, d) in files {
                z.start_file(*n, o).unwrap();
                z.write_all(d).unwrap();
            }
            z.finish().unwrap();
        }
        buf.into_inner()
    }

    pub fn manifest(name: &str, uuid: &str, module: &str) -> Vec<u8> {
        format!(
            r#"{{
  // Kommentar wie in vielen echten Packs
  "format_version": 2,
  "header": {{ "name": "{name}", "description": "§aBeschreibung", "uuid": "{uuid}", "version": [1, 2, 3], "min_engine_version": [1, 20, 0], }},
  "modules": [ {{ "type": "{module}", "uuid": "00000000-0000-0000-0000-00000000000{n}", "version": [1, 2, 3] }} ],
}}"#,
            n = name.len() % 10
        )
        .into_bytes()
    }

    #[test]
    fn parse_lenient_manifest() {
        let m = parse(&manifest("Mein §lPack", "AAAA-1", "resources"), None).unwrap();
        assert_eq!(m.name, "Mein Pack");
        assert_eq!(m.description, "Beschreibung");
        assert_eq!(m.uuid, "aaaa-1");
        assert_eq!(m.version, vec![1, 2, 3]);
        assert_eq!(m.version_string(), "1.2.3");
        assert_eq!(m.kind, PackKind::Resource);
        assert_eq!(m.min_engine.as_deref(), Some("1.20.0"));
        // Format 3: Version als Text, Skript-Modul -> Verhaltenspaket; Name aus Sprachdatei
        let v3 = br#"{"format_version":3,"header":{"name":"pack.name","uuid":"b","version":"2.0.1"},"modules":[{"type":"script","uuid":"c","version":"2.0.1"}]}"#;
        let m = parse(v3, Some("## Kommentar\npack.name=Toller Name\t## x\npack.description=Text")).unwrap();
        assert_eq!(m.name, "Toller Name");
        assert_eq!(m.version, vec![2, 0, 1]);
        assert_eq!(m.kind, PackKind::Behavior);
        assert!(parse(br#"{"header":{"name":"x","uuid":"u"},"modules":[{"type":"???"}]}"#, None).is_err());
        assert!(parse(br#"{"modules":[]}"#, None).is_err());
        // Kommentarzeichen in Texten bleiben erhalten
        assert_eq!(relax_json(r#"{"a":"http://x//y", /* c */ "b":[1,2,],}"#), r#"{"a":"http://x//y",  "b":[1,2]}"#);
    }

    #[test]
    fn mcaddon_with_multiple_modules_and_nested_packs() {
        let rp = manifest("RP", "r-1", "resources");
        let bp = manifest("BP", "b-1", "data");
        let nested_pack = zip_of(&[("manifest.json", &manifest("Innen", "n-1", "resources")), ("pack_icon.png", b"png")]);
        let addon = zip_of(&[
            ("Addon RP/manifest.json", &rp),
            ("Addon RP/textures/a.png", b"x"),
            ("Addon BP/manifest.json", &bp),
            ("Addon BP/entities/e.json", b"{}"),
            ("extra.mcpack", &nested_pack),
        ]);
        let entries = read_zip(&addon).unwrap();
        let found = analyze(&entries).unwrap();
        let packs: Vec<(String, PackKind, String)> = found
            .iter()
            .filter_map(|f| match f {
                Found::Pack { manifest, root, .. } => Some((manifest.name.clone(), manifest.kind, root.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(packs.len(), 3);
        assert!(packs.contains(&("RP".into(), PackKind::Resource, "Addon RP/".into())));
        assert!(packs.contains(&("BP".into(), PackKind::Behavior, "Addon BP/".into())));
        assert!(found.iter().any(|f| matches!(f, Found::Pack { manifest, nested: Some(n), root } if manifest.name == "Innen" && n == "extra.mcpack" && root.is_empty())));
        assert_eq!(files_of(&entries, "Addon BP/").len(), 2);
    }

    #[test]
    fn mcpack_root_and_world_detection() {
        let pack = zip_of(&[("manifest.json", &manifest("Solo", "s-1", "resources")), ("pack_icon.png", b"png")]);
        let found = analyze(&read_zip(&pack).unwrap()).unwrap();
        assert!(matches!(&found[..], [Found::Pack { root, .. }] if root.is_empty()));
        // Welt mit eigenen Packs: nur die Welt wird gemeldet
        let world = zip_of(&[
            ("level.dat", b"nbt"),
            ("levelname.txt", "§6Insel".as_bytes()),
            ("db/CURRENT", b"x"),
            ("resource_packs/rp/manifest.json", &manifest("WeltRP", "w-1", "resources")),
        ]);
        let found = analyze(&read_zip(&world).unwrap()).unwrap();
        assert_eq!(found, vec![Found::World { name: "Insel".into(), root: String::new(), nested: None }]);
        // Vorlage (.mctemplate): Manifest mit world_template + level.dat -> nur Vorlage
        let tpl = zip_of(&[("manifest.json", &manifest("Vorlage", "t-1", "world_template")), ("level.dat", b"nbt")]);
        let found = analyze(&read_zip(&tpl).unwrap()).unwrap();
        assert!(matches!(&found[..], [Found::Pack { manifest, .. }] if manifest.kind == PackKind::WorldTemplate));
    }

    #[test]
    fn zip_slip_is_rejected() {
        for bad in ["../evil.txt", "a/../../evil.txt", "/abs.txt", "C:/win.txt", "a\\..\\..\\evil.txt"] {
            let z = zip_of(&[("manifest.json", &manifest("X", "x", "resources")), (bad, b"boom")]);
            assert!(read_zip(&z).is_err(), "{bad} muss abgelehnt werden");
        }
        assert_eq!(safe_rel("./a//b/c.txt").as_deref(), Some("a/b/c.txt"));
        assert_eq!(safe_rel("a\\b.txt").as_deref(), Some("a/b.txt"));
        assert!(safe_rel("..").is_none());
        assert!(safe_rel("").is_none());
        assert!(read_zip(b"kein zip").is_err());
    }
}
