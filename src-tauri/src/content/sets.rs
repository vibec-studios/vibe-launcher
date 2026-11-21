//! Mod-Sets (Wunschlisten): globale, benannte Listen von Projekten (Modrinth/CurseForge, je mit Art:
//! Mod, Resourcepack, Shader, Datapack), die sich auf jede Instanz anwenden lassen. Gespeichert in
//! `<data>/mod_sets.json`. Anders als die Profile einer Instanz (`content/modsets.rs`, Ein/Aus-Zustände von
//! Dateien) beschreibt ein Set *Projekte* – welche Datei passt, wird erst beim Anwenden für Minecraft-Version
//! und Loader der Instanz bestimmt (`content/sets_apply.rs`).
//!
//! Außerdem hier: Teilen (Datei/Code), Einlesen einer Liste von Links/Namen und das Übernehmen eines alten
//! Profils als Set.
use super::index::ContentIndex;
use super::{curseforge as cf, modrinth as mr, provider, ContentKind, ProjectType, SearchQuery, SortOrder, Source};
use crate::error::{AppError, AppResult};
use crate::paths::Paths;
use crate::state::AppState;
use base64::Engine;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::PathBuf;

/// Maximale Anzahl Projekte je Set (schützt vor versehentlich riesigen Listen).
pub const MAX_ENTRIES: usize = 500;
/// Präfix des Teilen-Codes.
pub const CODE_PREFIX: &str = "VIBESET1.";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SetEntry {
    pub source: Source,
    /// Kanonische Projekt-ID (Modrinth-ID bzw. CurseForge-Zahl)
    pub project_id: String,
    #[serde(default)]
    pub slug: Option<String>,
    pub title: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    pub project_type: ProjectType,
    /// Hinzugefügt (ms seit Epoch)
    #[serde(default)]
    pub added: i64,
}

impl SetEntry {
    pub fn key(&self) -> String {
        entry_key(self.source, &self.project_id)
    }
}

pub fn entry_key(source: Source, project_id: &str) -> String {
    format!("{}:{project_id}", source.as_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModSet {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub created: i64,
    pub updated: i64,
    pub entries: Vec<SetEntry>,
    #[serde(default)]
    pub apply_on_create: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct Store {
    format: u32,
    sets: Vec<ModSet>,
}

/// Set mit Nutzung (für die Übersicht).
#[derive(Debug, Clone, Serialize)]
pub struct ModSetInfo {
    #[serde(flatten)]
    pub set: ModSet,
    /// Instanzen, auf die das Set angewendet wurde
    pub used_by: Vec<String>,
}

static LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

fn store_path(paths: &Paths) -> PathBuf {
    paths.root.join("mod_sets.json")
}

fn load(paths: &Paths) -> Store {
    std::fs::read(store_path(paths)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(paths: &Paths, s: &Store) -> AppResult<()> {
    let mut s = s.clone();
    s.format = 1;
    crate::util::write_json_atomic(&store_path(paths), &s)
}

/// Lese-Ändere-Schreibe unter Sperre.
fn modify<R>(paths: &Paths, f: impl FnOnce(&mut Store) -> AppResult<R>) -> AppResult<R> {
    let _g = LOCK.lock();
    let mut s = load(paths);
    let r = f(&mut s)?;
    save(paths, &s)?;
    Ok(r)
}

fn check_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::Invalid("Bitte einen Namen angeben".into()));
    }
    Ok(n.chars().take(60).collect())
}

fn clean_description(d: Option<String>) -> Option<String> {
    d.map(|d| d.trim().chars().take(400).collect::<String>()).filter(|d| !d.is_empty())
}

/// Einträge an eine Liste anhängen (doppelte werden übersprungen). Gibt die Zahl neuer Einträge zurück.
pub fn merge_entries(list: &mut Vec<SetEntry>, new: Vec<SetEntry>) -> usize {
    let mut seen: HashSet<String> = list.iter().map(SetEntry::key).collect();
    let now = crate::util::now_ms();
    let mut n = 0;
    for mut e in new {
        if list.len() >= MAX_ENTRIES {
            break;
        }
        if e.project_id.trim().is_empty() || !seen.insert(e.key()) {
            continue;
        }
        if e.added == 0 {
            e.added = now;
        }
        e.title = e.title.trim().chars().take(120).collect();
        if e.title.is_empty() {
            e.title = e.slug.clone().unwrap_or_else(|| e.project_id.clone());
        }
        list.push(e);
        n += 1;
    }
    n
}

pub fn get(paths: &Paths, id: &str) -> AppResult<ModSet> {
    load(paths).sets.into_iter().find(|s| s.id == id).ok_or_else(|| AppError::NotFound("Mod-Set".into()))
}

pub fn all(paths: &Paths) -> Vec<ModSet> {
    load(paths).sets
}

pub fn list(state: &AppState) -> Vec<ModSetInfo> {
    let sets = all(&state.paths);
    let usage = super::sets_apply::usage(state);
    sets.into_iter()
        .map(|s| {
            let used_by = usage.iter().filter(|(_, ids)| ids.contains(&s.id)).map(|(i, _)| i.clone()).collect();
            ModSetInfo { set: s, used_by }
        })
        .collect()
}

pub fn create(paths: &Paths, name: &str, description: Option<String>, entries: Vec<SetEntry>) -> AppResult<ModSet> {
    let name = check_name(name)?;
    modify(paths, |s| {
        let now = crate::util::now_ms();
        let mut set = ModSet { id: uuid::Uuid::new_v4().to_string(), name, description: clean_description(description), created: now, updated: now, entries: vec![], apply_on_create: false };
        merge_entries(&mut set.entries, entries);
        s.sets.push(set.clone());
        Ok(set)
    })
}

fn with_set(paths: &Paths, id: &str, f: impl FnOnce(&mut ModSet) -> AppResult<()>) -> AppResult<ModSet> {
    modify(paths, |s| {
        let set = s.sets.iter_mut().find(|x| x.id == id).ok_or_else(|| AppError::NotFound("Mod-Set".into()))?;
        f(set)?;
        set.updated = crate::util::now_ms();
        Ok(set.clone())
    })
}

pub fn update(paths: &Paths, id: &str, name: Option<String>, description: Option<String>) -> AppResult<ModSet> {
    let name = name.map(|n| check_name(&n)).transpose()?;
    with_set(paths, id, |set| {
        if let Some(n) = name {
            set.name = n;
        }
        if let Some(d) = description {
            set.description = clean_description(Some(d));
        }
        Ok(())
    })
}

pub fn delete(paths: &Paths, id: &str) -> AppResult<()> {
    modify(paths, |s| {
        s.sets.retain(|x| x.id != id);
        Ok(())
    })
}

pub fn set_apply_on_create(paths: &Paths, id: &str, enabled: bool) -> AppResult<ModSet> {
    with_set(paths, id, |set| {
        set.apply_on_create = enabled;
        Ok(())
    })
}

pub fn add_entries(paths: &Paths, id: &str, entries: Vec<SetEntry>) -> AppResult<ModSet> {
    with_set(paths, id, |set| {
        merge_entries(&mut set.entries, entries);
        Ok(())
    })
}

pub fn remove_entries(paths: &Paths, id: &str, keys: &[String]) -> AppResult<ModSet> {
    with_set(paths, id, |set| {
        set.entries.retain(|e| !keys.contains(&e.key()));
        Ok(())
    })
}

/// Kopie eines Sets („… (Kopie)“).
pub fn duplicate(paths: &Paths, id: &str) -> AppResult<ModSet> {
    let src = get(paths, id)?;
    create(paths, &format!("{} (Kopie)", src.name), src.description, src.entries)
}

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

fn parse_shared_json(bytes: &[u8]) -> AppResult<SharedSet> {
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

pub fn page_url(e: &SetEntry) -> String {
    let slug = e.slug.clone().unwrap_or_else(|| e.project_id.clone());
    match e.source {
        Source::Modrinth => mr::page_url(e.project_type, &slug),
        Source::Curseforge => {
            let class = match e.project_type {
                ProjectType::Mod => "mc-mods",
                ProjectType::Resourcepack => "texture-packs",
                ProjectType::Shader => "shaders",
                ProjectType::Datapack => "data-packs",
                ProjectType::Modpack => "modpacks",
            };
            if e.slug.is_some() {
                format!("https://www.curseforge.com/minecraft/{class}/{slug}")
            } else {
                format!("curseforge:{}", e.project_id)
            }
        }
        Source::Store(_) => format!("{}:{}", e.source.as_string(), e.project_id),
    }
}

// ------------------------------------------------------------------ Liste einfügen (Links/Namen)

/// Was in einer Zeile steht.
#[derive(Debug, Clone, PartialEq)]
pub enum LineRef {
    /// Modrinth-Slug oder -ID (aus Link oder `modrinth:`)
    Modrinth { id: String, hint: Option<ProjectType> },
    /// CurseForge-Slug aus einem Link
    CurseforgeSlug { slug: String, hint: Option<ProjectType> },
    /// CurseForge-Projekt-ID (`curseforge:238222`)
    CurseforgeId(String),
    /// Freier Name („Sodium“) – wird gesucht
    Name(String),
}

fn modrinth_type(seg: &str) -> Option<Option<ProjectType>> {
    Some(match seg {
        "mod" | "plugin" => Some(ProjectType::Mod),
        "resourcepack" => Some(ProjectType::Resourcepack),
        "shader" => Some(ProjectType::Shader),
        "datapack" => Some(ProjectType::Datapack),
        "modpack" => Some(ProjectType::Modpack),
        "project" => None,
        _ => return None,
    })
}

fn curseforge_type(seg: &str) -> Option<Option<ProjectType>> {
    Some(match seg {
        "mc-mods" | "mods" => Some(ProjectType::Mod),
        "texture-packs" | "resource-packs" => Some(ProjectType::Resourcepack),
        "shaders" => Some(ProjectType::Shader),
        "data-packs" => Some(ProjectType::Datapack),
        "modpacks" => Some(ProjectType::Modpack),
        "customization" => None,
        _ => return None,
    })
}

fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Aufzählungszeichen am Zeilenanfang entfernen („- “, „* “, „• “, „1. “, „2) “).
fn strip_bullet(s: &str) -> &str {
    let s = s.trim();
    for p in ["- ", "* ", "• ", "+ "] {
        if let Some(r) = s.strip_prefix(p) {
            return r.trim();
        }
    }
    let digits = s.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 && digits < 4 {
        let rest = &s[digits..];
        if let Some(r) = rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") ")) {
            return r.trim();
        }
    }
    s
}

/// Eine Zeile deuten. `None`: leer/Kommentar.
pub fn parse_line(raw: &str) -> Option<LineRef> {
    let line = strip_bullet(raw);
    if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
        return None;
    }
    // Link irgendwo in der Zeile („Sodium: https://modrinth.com/mod/sodium“)
    if let Some(pos) = line.find("http://").or_else(|| line.find("https://")).or_else(|| line.find("modrinth.com/")).or_else(|| line.find("curseforge.com/")) {
        let url_part: String = line[pos..].split_whitespace().next().unwrap_or_default().trim_end_matches([')', ',', '>', ']']).to_string();
        let with_scheme = if url_part.starts_with("http") { url_part } else { format!("https://{url_part}") };
        if let Ok(u) = url::Url::parse(&with_scheme) {
            let host = u.host_str().unwrap_or_default().trim_start_matches("www.").to_ascii_lowercase();
            let segs: Vec<String> = u.path_segments().map(|s| s.filter(|x| !x.is_empty()).map(|x| x.to_string()).collect()).unwrap_or_default();
            if host == "modrinth.com" && segs.len() >= 2 {
                if let Some(hint) = modrinth_type(&segs[0]) {
                    if valid_slug(&segs[1]) {
                        return Some(LineRef::Modrinth { id: segs[1].clone(), hint });
                    }
                }
            }
            if host.ends_with("curseforge.com") {
                // /minecraft/<klasse>/<slug>
                if segs.len() >= 3 && segs[0] == "minecraft" {
                    if let Some(hint) = curseforge_type(&segs[1]) {
                        if valid_slug(&segs[2]) {
                            return Some(LineRef::CurseforgeSlug { slug: segs[2].to_ascii_lowercase(), hint });
                        }
                    }
                }
                // /projects/<id>
                if segs.len() >= 2 && segs[0] == "projects" && segs[1].chars().all(|c| c.is_ascii_digit()) {
                    return Some(LineRef::CurseforgeId(segs[1].clone()));
                }
            }
        }
        // Unbekannter Link: nicht als Name suchen
        return Some(LineRef::Name(String::new()));
    }
    let lower = line.to_ascii_lowercase();
    for (p, mrinth) in [("modrinth:", true), ("mr:", true), ("curseforge:", false), ("cf:", false)] {
        if lower.starts_with(p) {
            let v = line[p.len()..].trim();
            if mrinth && valid_slug(v) {
                return Some(LineRef::Modrinth { id: v.to_string(), hint: None });
            }
            if !mrinth && !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()) {
                return Some(LineRef::CurseforgeId(v.to_string()));
            }
            if !mrinth && valid_slug(v) {
                return Some(LineRef::CurseforgeSlug { slug: v.to_ascii_lowercase(), hint: None });
            }
        }
    }
    Some(LineRef::Name(line.chars().take(100).collect()))
}

/// Text in Zeilen aufteilen. Eine Zeile ohne Link mit Kommas („Sodium, Lithium, Iris“) zählt als mehrere.
pub fn split_lines(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for l in text.lines() {
        let l = l.trim();
        if l.is_empty() {
            continue;
        }
        if !l.contains("://") && !l.contains(".com/") && (l.contains(',') || l.contains(';')) {
            out.extend(l.split([',', ';']).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()));
        } else {
            out.push(l.to_string());
        }
    }
    out
}

/// Vergleichsform eines Namens: klein, nur Buchstaben/Ziffern.
pub fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

/// Slug-Vermutung aus einem Namen („Mod Menu“ -> „mod-menu“, „Xaero's Minimap“ -> „xaeros-minimap“).
pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    for c in s.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if (c == ' ' || c == '-' || c == '_') && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

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

fn entry_from_mr(p: &mr::MrProject) -> SetEntry {
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

fn entry_from_cf(m: &cf::CfMod) -> SetEntry {
    let hit = cf::mod_to_hit(m);
    SetEntry { source: Source::Curseforge, project_id: hit.id, slug: Some(m.slug.clone()), title: hit.title, icon_url: hit.icon_url, project_type: hit.project_type, added: 0 }
}

pub fn entry_from_hit(h: &super::ProjectHit) -> SetEntry {
    SetEntry { source: h.source, project_id: h.id.clone(), slug: Some(h.slug.clone()).filter(|s| !s.is_empty()), title: h.title.clone(), icon_url: h.icon_url.clone(), project_type: h.project_type, added: 0 }
}

fn line_result(line: &str, status: LineStatus, entry: Option<SetEntry>, message: Option<&str>) -> ParsedLine {
    ParsedLine { line: line.to_string(), status, entry, message: message.map(str::to_string) }
}

async fn resolve_name(state: &AppState, line: &str, name: &str) -> ParsedLine {
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

async fn resolve_line(state: &AppState, line: String) -> ParsedLine {
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

// ------------------------------------------------------------------ Aus einer Instanz

pub fn project_type_of_kind(k: ContentKind) -> ProjectType {
    match k {
        ContentKind::Mod => ProjectType::Mod,
        ContentKind::Resourcepack => ProjectType::Resourcepack,
        ContentKind::Shader => ProjectType::Shader,
        ContentKind::Datapack => ProjectType::Datapack,
    }
}

/// Inhalt einer Instanz, der in ein Set übernommen werden kann.
#[derive(Debug, Clone, Serialize)]
pub struct InstanceCandidate {
    pub entry: SetEntry,
    pub kind: ContentKind,
    pub file_name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceCandidates {
    pub items: Vec<InstanceCandidate>,
    /// Dateien ohne bekannte Herkunft (nicht übernehmbar)
    pub unknown: Vec<String>,
}

/// Index-Eintrag -> Set-Eintrag (Schlüssel `mods/x.jar`). `fallback_title`: Name aus den Datei-Metadaten.
pub fn entry_for_key(idx: &ContentIndex, key: &str, fallback_title: Option<&str>) -> Option<(SetEntry, ContentKind)> {
    let e = idx.files.get(key)?;
    let folder = key.split('/').next().unwrap_or_default();
    let kind = ContentKind::from_folder(folder)?;
    let title = e.title.clone().or(fallback_title.map(str::to_string)).unwrap_or_else(|| e.project_id.clone());
    Some((
        SetEntry { source: e.source, project_id: e.project_id.clone(), slug: None, title, icon_url: e.icon_url.clone(), project_type: project_type_of_kind(kind), added: 0 },
        kind,
    ))
}

pub async fn instance_candidates(state: &AppState, instance_id: &str) -> AppResult<InstanceCandidates> {
    state.instances.get(instance_id)?;
    let mut items = Vec::new();
    let mut unknown = Vec::new();
    let mut seen = HashSet::new();
    for k in ContentKind::ALL {
        let (scanned, idx) = super::local::scan(state, instance_id, k).await?;
        for s in scanned {
            match entry_for_key(&idx, &s.key, s.meta.name.as_deref()) {
                Some((entry, kind)) => {
                    if seen.insert(entry.key()) {
                        items.push(InstanceCandidate { entry, kind, file_name: s.file_name.clone(), enabled: s.enabled });
                    }
                }
                None => unknown.push(s.file_name.clone()),
            }
        }
    }
    items.sort_by_key(|a| a.entry.title.to_lowercase());
    Ok(InstanceCandidates { items, unknown })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wave3_old_sets_are_opt_in() {
        let legacy = r#"{"id":"one","name":"Set","created":0,"updated":0,"entries":[]}"#;
        assert!(!serde_json::from_str::<ModSet>(legacy).unwrap().apply_on_create);
    }

    fn e(src: Source, id: &str, title: &str) -> SetEntry {
        SetEntry { source: src, project_id: id.into(), slug: Some(title.to_lowercase()), title: title.into(), icon_url: None, project_type: ProjectType::Mod, added: 0 }
    }

    #[test]
    fn parse_links_and_names() {
        assert_eq!(parse_line("https://modrinth.com/mod/sodium"), Some(LineRef::Modrinth { id: "sodium".into(), hint: Some(ProjectType::Mod) }));
        assert_eq!(parse_line("- modrinth.com/shader/complementary-reimagined/versions"), Some(LineRef::Modrinth { id: "complementary-reimagined".into(), hint: Some(ProjectType::Shader) }));
        assert_eq!(parse_line("Lithium: https://modrinth.com/mod/lithium)"), Some(LineRef::Modrinth { id: "lithium".into(), hint: Some(ProjectType::Mod) }));
        assert_eq!(parse_line("https://www.modrinth.com/project/AANobbMI"), Some(LineRef::Modrinth { id: "AANobbMI".into(), hint: None }));
        assert_eq!(
            parse_line("https://www.curseforge.com/minecraft/mc-mods/jei/files/123"),
            Some(LineRef::CurseforgeSlug { slug: "jei".into(), hint: Some(ProjectType::Mod) })
        );
        assert_eq!(
            parse_line("https://legacy.curseforge.com/minecraft/texture-packs/faithful-32x"),
            Some(LineRef::CurseforgeSlug { slug: "faithful-32x".into(), hint: Some(ProjectType::Resourcepack) })
        );
        assert_eq!(parse_line("https://www.curseforge.com/projects/238222"), Some(LineRef::CurseforgeId("238222".into())));
        assert_eq!(parse_line("curseforge:238222"), Some(LineRef::CurseforgeId("238222".into())));
        assert_eq!(parse_line("mr:iris"), Some(LineRef::Modrinth { id: "iris".into(), hint: None }));
        assert_eq!(parse_line("3. Xaero's Minimap"), Some(LineRef::Name("Xaero's Minimap".into())));
        assert_eq!(parse_line("  # Kommentar"), None);
        assert_eq!(parse_line("   "), None);
        // Unbekannter Link: nicht als Name suchen
        assert_eq!(parse_line("https://example.com/foo"), Some(LineRef::Name(String::new())));
        assert_eq!(split_lines("Sodium, Lithium; Iris\nhttps://modrinth.com/mod/a,b\n\n"), vec!["Sodium", "Lithium", "Iris", "https://modrinth.com/mod/a,b"]);
        assert_eq!(slugify("Xaero's Minimap"), "xaeros-minimap");
        assert_eq!(slugify("Mod Menu"), "mod-menu");
        assert_eq!(norm("Fabric API"), "fabricapi");
    }

    #[test]
    fn merge_dedupes() {
        let mut list = vec![e(Source::Modrinth, "a", "A")];
        let blank = SetEntry { slug: Some("bee".into()), ..e(Source::Modrinth, "b", "  ") };
        let n = merge_entries(&mut list, vec![e(Source::Modrinth, "a", "A2"), e(Source::Curseforge, "a", "A"), blank, e(Source::Modrinth, "", "x")]);
        assert_eq!(n, 2);
        assert_eq!(list.len(), 3);
        // Leerer Titel -> Slug
        assert_eq!(list[2].title, "bee");
        assert!(list[1..].iter().all(|e| e.added > 0));
    }

    #[test]
    fn share_roundtrip() {
        let set = ModSet {
            id: "x".into(),
            name: "Performance".into(),
            description: Some("Schneller".into()),
            created: 1,
            updated: 2,
            apply_on_create: true,
            entries: vec![
                SetEntry { icon_url: Some("https://cdn.modrinth.com/data/AANobbMI/icon.png".into()), ..e(Source::Modrinth, "AANobbMI", "Sodium") },
                SetEntry { project_type: ProjectType::Shader, ..e(Source::Curseforge, "123", "BSL") },
            ],
        };
        // Datei: mit Icons, Felder wie dokumentiert
        let file = serde_json::to_value(to_shared(&set, true)).unwrap();
        assert!(file.get("apply_on_create").is_none());
        assert_eq!(file["vibe_mod_set"], 1);
        assert_eq!(file["entries"][0]["type"], "mod");
        assert_eq!(file["entries"][0]["source"], "modrinth");
        assert_eq!(file["entries"][1]["type"], "shader");
        assert!(file["entries"][0]["icon"].is_string());
        let text = serde_json::to_string_pretty(&file).unwrap();
        let back = parse_shared(&text).unwrap().unwrap();
        let (name, desc, entries) = from_shared(back);
        assert_eq!(name, "Performance");
        assert_eq!(desc.as_deref(), Some("Schneller"));
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].icon_url.as_deref(), Some("https://cdn.modrinth.com/data/AANobbMI/icon.png"));
        assert_eq!(entries[1].project_type, ProjectType::Shader);
        // Code: ohne Icons, auch mitten im Text
        let code = encode_code(&to_shared(&set, false)).unwrap();
        assert!(code.starts_with(CODE_PREFIX));
        let back = parse_shared(&format!("Hier mein Set: {code} – viel Spaß")).unwrap().unwrap();
        assert_eq!(back.name, "Performance");
        assert_eq!(back.entries.len(), 2);
        assert_eq!(back.entries[0].icon, None);
        assert_eq!(back.entries[1].source, Source::Curseforge);
        // Kaputt / neuere Version / gar kein Set
        assert!(parse_shared(&code[..code.len() - 8]).unwrap().is_err());
        assert!(parse_shared(r#"{"vibe_mod_set": 2, "name": "x", "entries": []}"#).unwrap().is_err());
        assert!(parse_shared("https://modrinth.com/mod/sodium").is_none());
        // Linkliste
        assert_eq!(page_url(&set.entries[0]), "https://modrinth.com/mod/sodium");
        assert_eq!(page_url(&set.entries[1]), "https://www.curseforge.com/minecraft/shaders/bsl");
    }

    #[test]
    fn store_crud() {
        let dir = std::env::temp_dir().join(format!("vl-sets-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let paths = Paths { root: dir.clone() };
        let s = create(&paths, "  QoL  ", None, vec![e(Source::Modrinth, "a", "A")]).unwrap();
        assert_eq!(s.name, "QoL");
        assert!(create(&paths, " ", None, vec![]).is_err());
        let s = add_entries(&paths, &s.id, vec![e(Source::Modrinth, "b", "B"), e(Source::Modrinth, "a", "A")]).unwrap();
        assert_eq!(s.entries.len(), 2);
        let s = remove_entries(&paths, &s.id, &["modrinth:a".into()]).unwrap();
        assert_eq!(s.entries.iter().map(|e| e.project_id.as_str()).collect::<Vec<_>>(), vec!["b"]);
        let s = update(&paths, &s.id, Some("Meine QoL".into()), Some("".into())).unwrap();
        assert_eq!(s.name, "Meine QoL");
        assert_eq!(s.description, None);
        let d = duplicate(&paths, &s.id).unwrap();
        assert_eq!(all(&paths).len(), 2);
        assert_eq!(d.entries.len(), 1);
        delete(&paths, &s.id).unwrap();
        assert_eq!(all(&paths).len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn index_entry_to_set_entry() {
        let mut idx = ContentIndex::default();
        idx.files.insert(
            "shaderpacks/bsl.zip".into(),
            super::super::index::IndexEntry {
                source: Source::Curseforge,
                project_id: "123".into(),
                version_id: "9".into(),
                sha1: None,
                sha512: None,
                title: None,
                icon_url: None,
                version_number: None,
                url: None,
                size: None,
                date: None,
                release_type: None,
                side: None,
            },
        );
        let (entry, kind) = entry_for_key(&idx, "shaderpacks/bsl.zip", Some("BSL Shaders")).unwrap();
        assert_eq!(kind, ContentKind::Shader);
        assert_eq!(entry.project_type, ProjectType::Shader);
        assert_eq!(entry.title, "BSL Shaders");
        assert!(entry_for_key(&idx, "mods/unknown.jar", None).is_none());
    }
}
