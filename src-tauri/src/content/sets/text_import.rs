use super::*;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LineStatus {
    /// Eindeutig erkannt
    Ok,
    /// Über die Suche gefunden – bitte prüfen
    Guess,
    NotFound,
    /// Unbekannter Link oder CurseForge nicht eingerichtet
    Unsupported,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedLine {
    pub line: String,
    pub status: LineStatus,
    pub entry: Option<SetEntry>,
    pub message: Option<String>,
}

/// Ergebnis von „Liste einfügen“/„Importieren“.
#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    /// Name aus Datei/Code (bei Linklisten leer)
    pub name: Option<String>,
    pub description: Option<String>,
    pub lines: Vec<ParsedLine>,
}

pub(super) fn entry_from_mr(p: &mr::MrProject) -> SetEntry {
    let hit = mr::project_to_hit(p, String::new());
    SetEntry {
        source: Source::Modrinth,
        project_id: p.id.clone(),
        slug: Some(p.slug.clone()),
        title: p.title.clone(),
        icon_url: hit.icon_url,
        project_type: hit.project_type,
        added: 0,
    }
}

pub(super) fn entry_from_cf(m: &cf::CfMod) -> SetEntry {
    let hit = cf::mod_to_hit(m);
    SetEntry { source: Source::Curseforge, project_id: hit.id, slug: Some(m.slug.clone()), title: hit.title, icon_url: hit.icon_url, project_type: hit.project_type, added: 0 }
}

pub fn entry_from_hit(h: &crate::content::ProjectHit) -> SetEntry {
    SetEntry { source: h.source, project_id: h.id.clone(), slug: Some(h.slug.clone()).filter(|s| !s.is_empty()), title: h.title.clone(), icon_url: h.icon_url.clone(), project_type: h.project_type, added: 0 }
}

pub(super) fn line_result(line: &str, status: LineStatus, entry: Option<SetEntry>, message: Option<&str>) -> ParsedLine {
    ParsedLine { line: line.to_string(), status, entry, message: message.map(str::to_string) }
}

pub(super) async fn resolve_name(state: &AppState, line: &str, name: &str) -> ParsedLine {
    // 1. Slug-Vermutung (exakt, billig): „Sodium“ -> modrinth.com/mod/sodium
    let slug = slugify(name);
    if valid_slug(&slug) {
        if let Ok(p) = mr::raw_project(state, &slug).await {
            if norm(&p.title) == norm(name) || norm(&p.slug) == norm(name) {
                return line_result(line, LineStatus::Ok, Some(entry_from_mr(&p)), None);
            }
        }
    }
    // 2. Suche (Mods, dann Shader/Resourcepacks): exakter Titel = erkannt, sonst bester Treffer als Vorschlag
    let mut guess: Option<SetEntry> = None;
    for pt in [ProjectType::Mod, ProjectType::Shader, ProjectType::Resourcepack, ProjectType::Datapack] {
        let q = SearchQuery {
            source: Source::Modrinth,
            query: name.to_string(),
            project_type: pt,
            game_version: None,
            loader: None,
            categories: vec![],
            sort: SortOrder::Relevance,
            offset: 0,
            limit: 5,
            created_after: None,
        };
        let Ok(r) = provider::search(state, &q).await else { continue };
        if let Some(h) = r.hits.iter().find(|h| norm(&h.title) == norm(name)) {
            return line_result(line, LineStatus::Ok, Some(entry_from_hit(h)), None);
        }
        if guess.is_none() {
            guess = r.hits.first().map(entry_from_hit);
        }
    }
    match guess {
        Some(e) => line_result(line, LineStatus::Guess, Some(e), None),
        None => line_result(line, LineStatus::NotFound, None, None),
    }
}

pub(super) async fn resolve_line(state: &AppState, line: String) -> ParsedLine {
    let Some(r) = parse_line(&line) else { return line_result(&line, LineStatus::NotFound, None, None) };
    match r {
        LineRef::Modrinth { id, .. } => match mr::raw_project(state, &id).await {
            Ok(p) => line_result(&line, LineStatus::Ok, Some(entry_from_mr(&p)), None),
            Err(AppError::NotFound(_)) => line_result(&line, LineStatus::NotFound, None, None),
            Err(e) => line_result(&line, LineStatus::NotFound, None, Some(&e.to_string())),
        },
        LineRef::CurseforgeSlug { slug, hint } => {
            if !cf::available(state) {
                return line_result(&line, LineStatus::Unsupported, None, Some("curseforge"));
            }
            match cf::mod_by_slug(state, &slug, hint).await {
                Ok(Some(m)) => line_result(&line, LineStatus::Ok, Some(entry_from_cf(&m)), None),
                Ok(None) => line_result(&line, LineStatus::NotFound, None, None),
                Err(e) => line_result(&line, LineStatus::NotFound, None, Some(&e.to_string())),
            }
        }
        LineRef::CurseforgeId(id) => {
            if !cf::available(state) {
                return line_result(&line, LineStatus::Unsupported, None, Some("curseforge"));
            }
            match cf::raw_mod(state, &id).await {
                Ok(m) => line_result(&line, LineStatus::Ok, Some(entry_from_cf(&m)), None),
                Err(_) => line_result(&line, LineStatus::NotFound, None, None),
            }
        }
        LineRef::Name(n) if n.is_empty() => line_result(&line, LineStatus::Unsupported, None, Some("link")),
        LineRef::Name(n) => resolve_name(state, &line, &n).await,
    }
}

/// Liste (Links, Slugs, Namen) auflösen – Reihenfolge bleibt erhalten.
pub async fn parse_list(state: &AppState, text: &str) -> AppResult<Vec<ParsedLine>> {
    let lines: Vec<String> = split_lines(text).into_iter().filter(|l| parse_line(l).is_some()).collect();
    if lines.len() > 300 {
        return Err(AppError::Invalid("Zu viele Zeilen (höchstens 300 auf einmal)".into()));
    }
    let futs: Vec<_> = lines.into_iter().map(|l| resolve_line(state, l)).collect();
    let out: Vec<ParsedLine> = futures::stream::iter(futs).buffered(6).collect().await;
    Ok(out)
}

/// Fehlende Icons (Code ohne Icons, alte Dateien) von Modrinth/CurseForge nachladen. Fehler werden ignoriert.
pub async fn enrich_icons(state: &AppState, entries: &mut [SetEntry]) {
    let mr_ids: Vec<String> = entries.iter().filter(|e| e.source == Source::Modrinth && e.icon_url.is_none()).map(|e| e.project_id.clone()).collect();
    if !mr_ids.is_empty() {
        if let Ok(ps) = mr::raw_projects(state, &mr_ids).await {
            for p in ps {
                if let Some(e) = entries.iter_mut().find(|e| e.source == Source::Modrinth && e.project_id == p.id) {
                    e.icon_url = p.icon_url.clone().filter(|u| !u.is_empty());
                }
            }
        }
    }
    let cf_ids: Vec<u64> = entries.iter().filter(|e| e.source == Source::Curseforge && e.icon_url.is_none()).filter_map(|e| e.project_id.parse().ok()).collect();
    if !cf_ids.is_empty() && cf::available(state) {
        if let Ok(ms) = cf::raw_mods(state, &cf_ids).await {
            for m in ms {
                if let Some(e) = entries.iter_mut().find(|e| e.source == Source::Curseforge && e.project_id == m.id.to_string()) {
                    e.icon_url = cf::mod_to_hit(&m).icon_url;
                }
            }
        }
    }
}

/// Importieren: Code, Set-Datei (JSON) oder Link-Liste.
pub async fn import_text(state: &AppState, text: &str) -> AppResult<ImportResult> {
    if let Some(shared) = parse_shared(text) {
        let (name, description, mut entries) = from_shared(shared?);
        enrich_icons(state, &mut entries).await;
        let lines = entries.into_iter().map(|e| ParsedLine { line: e.title.clone(), status: LineStatus::Ok, entry: Some(e), message: None }).collect();
        return Ok(ImportResult { name: Some(name), description, lines });
    }
    Ok(ImportResult { name: None, description: None, lines: parse_list(state, text).await? })
}

pub async fn import_file(state: &AppState, path: &str) -> AppResult<ImportResult> {
    let meta = std::fs::metadata(path)?;
    if meta.len() > 4 * 1024 * 1024 {
        return Err(AppError::Invalid("Die Datei ist zu groß für ein Mod-Set".into()));
    }
    let text = String::from_utf8_lossy(&std::fs::read(path)?).to_string();
    import_text(state, &text).await
}
