use super::*;

/// Bukkit-/Paper-Plugin-Metadaten (`plugin.yml`, `paper-plugin.yml`). Bewusst schlichter YAML-Leser:
/// nur Schlüssel der obersten Ebene, Skalare, Inline-Listen `[a, b]` und Blocklisten `- a`.
#[derive(Debug, Default, PartialEq)]
pub struct PluginYml {
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub authors: Vec<String>,
    pub main: Option<String>,
    pub depend: Vec<String>,
    pub folia_supported: bool,
}

pub(super) fn yaml_scalar(v: &str) -> String {
    let v = v.trim();
    if let Some(q) = v.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let inner = &v[1..];
        return match inner.find(q) {
            Some(end) => inner[..end].to_string(),
            None => inner.to_string(),
        };
    }
    match v.find(" #") {
        Some(i) => v[..i].trim().to_string(),
        None => v.to_string(),
    }
}

pub(super) fn yaml_list(v: &str) -> Vec<String> {
    let v = v.trim();
    if let Some(inner) = v.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
        inner.split(',').map(yaml_scalar).filter(|s| !s.is_empty()).collect()
    } else if v.is_empty() {
        vec![]
    } else {
        vec![yaml_scalar(v)]
    }
}

pub fn parse_plugin_yml(text: &str) -> PluginYml {
    let mut out = PluginYml::default();
    let mut current: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim_end();
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let top = !line.starts_with(' ') && !line.starts_with('\t');
        if top {
            if let Some((k, v)) = line.split_once(':') {
                let key = k.trim().to_ascii_lowercase();
                let val = v.trim();
                current = Some(key.clone());
                match key.as_str() {
                    "name" => out.name = Some(yaml_scalar(val)).filter(|s| !s.is_empty()),
                    "version" => out.version = Some(yaml_scalar(val)).filter(|s| !s.is_empty()),
                    "description" => out.description = Some(yaml_scalar(val)).filter(|s| !s.is_empty() && s != "|" && s != ">"),
                    "main" => out.main = Some(yaml_scalar(val)).filter(|s| !s.is_empty()),
                    "author" => out.authors.extend(yaml_list(val)),
                    "authors" => out.authors.extend(yaml_list(val)),
                    "depend" => out.depend.extend(yaml_list(val)),
                    "folia-supported" => out.folia_supported = yaml_scalar(val).eq_ignore_ascii_case("true"),
                    _ => {}
                }
            }
            continue;
        }
        // Blockliste unter einem Schlüssel der obersten Ebene
        if let Some(item) = line.trim_start().strip_prefix("- ") {
            match current.as_deref() {
                Some("authors") | Some("author") => out.authors.push(yaml_scalar(item)),
                Some("depend") => out.depend.push(yaml_scalar(item)),
                _ => {}
            }
        }
    }
    out.authors.retain(|a| !a.is_empty());
    out.authors.dedup();
    out
}

/// `velocity-plugin.json` / `bungee.yml` gibt es auf Welt-Servern nicht; für Mods lesen wir die
/// Launcher-Metadaten (`content::meta`).
pub(super) fn read_plugin_meta(path: &Path) -> Option<PluginYml> {
    let f = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f)).ok()?;
    for name in ["paper-plugin.yml", "plugin.yml"] {
        if let Ok(mut e) = zip.by_name(name) {
            let mut s = String::new();
            if std::io::Read::read_to_string(&mut e, &mut s).is_ok() {
                let y = parse_plugin_yml(&s);
                if y.name.is_some() {
                    return Some(y);
                }
            }
        }
    }
    None
}
