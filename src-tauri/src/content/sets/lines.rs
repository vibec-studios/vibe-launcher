use super::*;

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

pub(super) fn modrinth_type(seg: &str) -> Option<Option<ProjectType>> {
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

pub(super) fn curseforge_type(seg: &str) -> Option<Option<ProjectType>> {
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

pub(super) fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Aufzählungszeichen am Zeilenanfang entfernen („- “, „* “, „• “, „1. “, „2) “).
pub(super) fn strip_bullet(s: &str) -> &str {
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
