use super::*;

// ------------------------------------------------------------------ Teilen (Datei / Code)

/// Austauschformat (Datei `.vibeset.json` bzw. komprimiert im Code).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SharedSet {
    /// Formatversion
    pub vibe_mod_set: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub entries: Vec<SharedEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SharedEntry {
    pub source: Source,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    pub title: String,
    #[serde(rename = "type")]
    pub project_type: ProjectType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

pub fn to_shared(set: &ModSet, with_icons: bool) -> SharedSet {
    SharedSet {
        vibe_mod_set: 1,
        name: set.name.clone(),
        description: set.description.clone(),
        entries: set
            .entries
            .iter()
            .map(|e| SharedEntry {
                source: e.source,
                id: e.project_id.clone(),
                slug: e.slug.clone(),
                title: e.title.clone(),
                project_type: e.project_type,
                icon: if with_icons { e.icon_url.clone() } else { None },
            })
            .collect(),
    }
}

pub fn from_shared(s: SharedSet) -> (String, Option<String>, Vec<SetEntry>) {
    let entries = s
        .entries
        .into_iter()
        // Eigene Stores sind beim Freund evtl. nicht eingerichtet – trotzdem übernehmen; Auflösung meldet es später
        .map(|e| SetEntry { source: e.source, project_id: e.id, slug: e.slug, title: e.title, icon_url: e.icon.filter(|u| u.starts_with("https://")), project_type: e.project_type, added: 0 })
        .collect();
    (s.name, s.description, entries)
}

/// Kompakter Code zum Einfügen in Chats: `VIBESET1.` + base64url(deflate(JSON ohne Icons)).
pub fn encode_code(s: &SharedSet) -> AppResult<String> {
    let json = serde_json::to_vec(s)?;
    let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    enc.write_all(&json)?;
    let bytes = enc.finish()?;
    Ok(format!("{CODE_PREFIX}{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)))
}

/// Code (auch mitten in einem Text, z. B. „Hier mein Set: VIBESET1.…“) lesen.
pub fn decode_code(text: &str) -> AppResult<SharedSet> {
    let start = text.find(CODE_PREFIX).ok_or_else(|| AppError::Invalid("Kein Mod-Set-Code gefunden".into()))?;
    let body: String = text[start + CODE_PREFIX.len()..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body.as_bytes())
        .map_err(|_| AppError::Invalid("Der Code ist unvollständig oder beschädigt".into()))?;
    let mut out = Vec::new();
    flate2::read::DeflateDecoder::new(&bytes[..])
        .take(4 * 1024 * 1024)
        .read_to_end(&mut out)
        .map_err(|_| AppError::Invalid("Der Code ist unvollständig oder beschädigt".into()))?;
    parse_shared_json(&out)
}

pub(super) fn parse_shared_json(bytes: &[u8]) -> AppResult<SharedSet> {
    let s: SharedSet = serde_json::from_slice(bytes).map_err(|_| AppError::Invalid("Das ist kein Mod-Set".into()))?;
    if s.vibe_mod_set == 0 || s.vibe_mod_set > 1 {
        return Err(AppError::Invalid("Dieses Mod-Set stammt aus einer neueren Version von Vibe – bitte den Launcher aktualisieren".into()));
    }
    if s.entries.len() > MAX_ENTRIES {
        return Err(AppError::Invalid(format!("Zu viele Einträge (höchstens {MAX_ENTRIES})")));
    }
    Ok(s)
}

/// Datei- oder Textinhalt als geteiltes Set erkennen (JSON oder Code). `None`: weder noch (dann Link-Liste).
pub fn parse_shared(text: &str) -> Option<AppResult<SharedSet>> {
    let t = text.trim().trim_start_matches('\u{feff}');
    if t.contains(CODE_PREFIX) {
        return Some(decode_code(t));
    }
    if t.starts_with('{') && t.contains("vibe_mod_set") {
        return Some(parse_shared_json(t.as_bytes()));
    }
    None
}

pub fn export_file(paths: &Paths, id: &str, dest: &str) -> AppResult<()> {
    let set = get(paths, id)?;
    let data = serde_json::to_vec_pretty(&to_shared(&set, true))?;
    std::fs::write(dest, data)?;
    Ok(())
}

pub fn export_code(paths: &Paths, id: &str) -> AppResult<String> {
    encode_code(&to_shared(&get(paths, id)?, false))
}

/// Linkliste (eine Projektseite je Zeile) – lässt sich auch in anderen Launchern/Chats lesen und hier wieder einfügen.
pub fn export_links(paths: &Paths, id: &str) -> AppResult<String> {
    let set = get(paths, id)?;
    Ok(set.entries.iter().map(page_url).collect::<Vec<_>>().join("\n"))
}
