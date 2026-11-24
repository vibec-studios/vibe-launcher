use super::issue::{PackIssue, PackResult};
use super::limits::*;
use super::manifest::{Arguments, Library, Manifest, Profile, RawArguments, RawManifest};
use super::{FORMAT, FORMAT_VERSION};
use crate::instance::LoaderKind;
use std::collections::HashSet;

pub(super) fn is_id(s: &str) -> bool {
    let first = s.chars().next().is_some_and(|f| f.is_ascii_lowercase() || f.is_ascii_digit());
    first && (2..=32).contains(&s.len()) && s.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

pub(super) fn is_loader_version(s: &str) -> bool {
    (1..=40).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c))
}

pub(super) fn is_mc_version(s: &str) -> bool {
    is_loader_version(s) && !s.starts_with('.') && !s.contains("..")
}

pub(super) fn is_java_class(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 256
        && s.split('.').all(|seg| {
            let mut c = seg.chars();
            c.next().is_some_and(|f| f.is_ascii_alphabetic() || f == '_' || f == '$') && c.all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '$')
        })
}

fn is_maven_part(s: &str) -> bool {
    let mut c = s.chars();
    c.next().is_some_and(|f| f.is_ascii_alphanumeric() || f == '_') && c.all(|ch| ch.is_ascii_alphanumeric() || "._+-".contains(ch)) && !s.contains("..")
}

pub(super) fn is_maven(s: &str) -> bool {
    let parts: Vec<&str> = s.split(':').collect();
    (3..=4).contains(&parts.len()) && s.len() <= 256 && parts.iter().all(|p| is_maven_part(p))
}

pub(super) fn safe_rel(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 512
        && !p.starts_with('/')
        && !p.contains('\\')
        && !p.contains(':')
        && !p.chars().any(|c| c.is_control())
        && p.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

pub(super) fn is_https(u: &str) -> bool {
    url::Url::parse(u).is_ok_and(|x| x.scheme() == "https" && x.host_str().is_some_and(|h| !h.is_empty()) && x.username().is_empty() && x.password().is_none())
}

pub(super) fn is_sha1(s: &str) -> bool {
    s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn text(v: Option<String>, max: usize, code: &'static str, what: &str) -> PackResult<Option<String>> {
    let Some(v) = v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) else { return Ok(None) };
    if v.chars().count() > max || v.chars().any(|c| c.is_control() && c != '\n') {
        return Err(PackIssue::new(code, format!("{what} darf höchstens {max} Zeichen lang sein.")).with("max", max));
    }
    Ok(Some(v))
}

fn parse_mods(s: &str) -> PackResult<LoaderKind> {
    match s {
        "fabric" => Ok(LoaderKind::Fabric),
        "quilt" => Ok(LoaderKind::Quilt),
        "forge" => Ok(LoaderKind::Forge),
        "neoforge" => Ok(LoaderKind::Neoforge),
        "vanilla" => Ok(LoaderKind::Vanilla),
        _ => Err(PackIssue::new("mods_invalid", format!("„mods“ muss fabric, quilt, forge, neoforge oder vanilla sein (gefunden: „{s}“).")).with("value", s)),
    }
}

fn strings(list: Vec<serde_json::Value>) -> PackResult<Vec<String>> {
    list.into_iter()
        .map(|v| match v {
            serde_json::Value::String(s) if s.len() <= MAX_ARGUMENT_LEN && !s.chars().any(|c| c.is_control()) => Ok(s),
            serde_json::Value::String(_) => Err(PackIssue::new("argument_invalid", format!("Ein Start-Argument ist länger als {MAX_ARGUMENT_LEN} Zeichen oder enthält Steuerzeichen.")).with("max", MAX_ARGUMENT_LEN)),
            _ => Err(PackIssue::new("arguments_not_strings", "Start-Argumente dürfen nur einfache Texte sein, keine Regel-Objekte.")),
        })
        .collect()
}

fn arguments(raw: Option<RawArguments>) -> PackResult<Arguments> {
    let raw = raw.unwrap_or_default();
    if raw.jvm.len() + raw.game.len() > MAX_ARGUMENTS {
        return Err(PackIssue::new("arguments_too_many", format!("Das Profil hat mehr als {MAX_ARGUMENTS} Start-Argumente.")).with("max", MAX_ARGUMENTS));
    }
    Ok(Arguments { jvm: strings(raw.jvm)?, game: strings(raw.game)? })
}

fn library(l: Library, seen: &mut HashSet<String>) -> PackResult<Library> {
    let name = l.name.trim().to_string();
    if !is_maven(&name) {
        return Err(PackIssue::new("library_name_invalid", format!("„{name}“ ist keine gültige Maven-Koordinate (group:artifact:version[:classifier]).")).with("name", &name));
    }
    let path = Library { name: name.clone(), ..Default::default() }.maven_path();
    if !seen.insert(name.clone()) || !seen.insert(format!("path:{path}")) {
        return Err(PackIssue::new("library_duplicate", format!("Die Bibliothek „{name}“ ist doppelt eingetragen.")).with("name", &name));
    }
    let sha1 = l.sha1.map(|s| s.trim().to_ascii_lowercase()).filter(|s| is_sha1(s));
    match (l.file, l.url) {
        (Some(file), None) => {
            if !safe_rel(&file) || !file.to_ascii_lowercase().ends_with(".jar") {
                return Err(PackIssue::new("library_file_invalid", format!("„{file}“ ist kein erlaubter .jar-Pfad im Pack.")).with("name", &name).with("file", &file));
            }
            Ok(Library { name, file: Some(file), url: None, sha1, size: l.size })
        }
        (None, Some(url)) => {
            if !is_https(&url) {
                return Err(PackIssue::new("library_url_invalid", format!("Die Bibliothek „{name}“ darf nur über https geladen werden.")).with("name", &name));
            }
            let Some(sha1) = sha1 else {
                return Err(PackIssue::new("library_sha1_missing", format!("Für „{name}“ fehlt eine gültige SHA-1-Prüfsumme.")).with("name", &name));
            };
            let Some(size) = l.size.filter(|s| (1..=MAX_REMOTE_SIZE).contains(s)) else {
                return Err(PackIssue::new("library_size_missing", format!("Für „{name}“ fehlt eine gültige Größe.")).with("name", &name));
            };
            Ok(Library { name, file: None, url: Some(url), sha1: Some(sha1), size: Some(size) })
        }
        _ => Err(PackIssue::new("library_source", format!("Die Bibliothek „{name}“ braucht genau eins von „file“ oder „url“.")).with("name", &name)),
    }
}

fn minecraft(list: &[String]) -> PackResult<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for v in list.iter().map(|v| v.trim()) {
        if !is_mc_version(v) {
            return Err(PackIssue::new("mc_invalid", format!("„{v}“ ist keine gültige Minecraft-Version.")).with("version", v));
        }
        if !out.iter().any(|x| x == v) {
            out.push(v.to_string());
        }
    }
    if out.is_empty() {
        return Err(PackIssue::new("mc_empty", "Das Pack nennt keine Minecraft-Version."));
    }
    if out.len() > MAX_MC_VERSIONS {
        return Err(PackIssue::new("mc_too_many", format!("Das Pack nennt mehr als {MAX_MC_VERSIONS} Minecraft-Versionen.")).with("max", MAX_MC_VERSIONS));
    }
    Ok(out)
}

fn header(raw: &RawManifest) -> PackResult<(String, String, String)> {
    if raw.format != FORMAT {
        return Err(PackIssue::new("format_unknown", format!("Das ist kein Loader-Pack für den Vibe Launcher („format“ muss „{FORMAT}“ sein).")));
    }
    match raw.version {
        Some(FORMAT_VERSION) => {}
        Some(v) => return Err(PackIssue::new("format_version", format!("Das Pack nutzt Format-Version {v}, dieser Launcher kennt nur Version {FORMAT_VERSION}.")).with("version", v)),
        None => return Err(PackIssue::new("format_version", "Im Pack fehlt die Format-Version.").with("version", "?")),
    }
    let id = raw.id.trim().to_string();
    if !is_id(&id) {
        return Err(PackIssue::new("id_invalid", format!("Die ID „{id}“ ist ungültig: 2–32 Zeichen, nur a–z, 0–9 und Bindestrich, am Anfang kein Bindestrich.")).with("id", &id));
    }
    let lv = raw.loader_version.trim().to_string();
    if !is_loader_version(&lv) {
        return Err(PackIssue::new("version_invalid", format!("Die Loader-Version „{lv}“ ist ungültig: 1–40 Zeichen aus Buchstaben, Ziffern, Punkt, Plus, Minus und Unterstrich.")).with("version", &lv));
    }
    let name = raw.name.trim().to_string();
    if name.is_empty() || name.chars().count() > MAX_NAME || name.chars().any(|c| c.is_control()) {
        return Err(PackIssue::new("name_invalid", format!("Der Name muss 1–{MAX_NAME} Zeichen lang sein.")).with("max", MAX_NAME));
    }
    Ok((id, lv, name))
}

pub(super) fn validate(raw: RawManifest) -> PackResult<Manifest> {
    let (id, loader_version, name) = header(&raw)?;
    let description = text(raw.description, MAX_DESCRIPTION, "description_too_long", "Die Beschreibung")?;
    let author = text(raw.author, MAX_AUTHOR, "author_too_long", "Der Autor")?;
    let homepage = raw.homepage.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if homepage.as_deref().is_some_and(|h| !is_https(h) || h.len() > 300) {
        return Err(PackIssue::new("homepage_invalid", "Die Homepage muss eine https-Adresse sein."));
    }
    let icon = raw.icon.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if icon.as_deref().is_some_and(|i| !safe_rel(i) || !i.to_ascii_lowercase().ends_with(".png")) {
        return Err(PackIssue::new("icon_invalid", "Das Icon muss eine PNG-Datei im Pack sein."));
    }
    let minecraft = minecraft(&raw.minecraft)?;
    let mods = parse_mods(raw.mods.trim())?;
    let Some(profile) = raw.profile else { return Err(PackIssue::new("profile_missing", "Im Pack fehlt das Loader-Profil („profile“).")) };
    let main_class = profile.main_class.trim().to_string();
    if !is_java_class(&main_class) {
        return Err(PackIssue::new("main_class_invalid", format!("„{main_class}“ ist kein gültiger Java-Klassenname.")).with("class", &main_class));
    }
    let arguments = arguments(profile.arguments)?;
    if profile.libraries.len() > MAX_LIBRARIES {
        return Err(PackIssue::new("libraries_too_many", format!("Das Pack hat mehr als {MAX_LIBRARIES} Bibliotheken.")).with("max", MAX_LIBRARIES));
    }
    let mut seen = HashSet::new();
    let libraries = profile.libraries.into_iter().map(|l| library(l, &mut seen)).collect::<PackResult<Vec<_>>>()?;
    Ok(Manifest {
        format: FORMAT.into(),
        version: FORMAT_VERSION,
        id,
        name,
        loader_version,
        description,
        author,
        homepage,
        icon,
        minecraft,
        mods,
        profile: Profile { main_class, arguments, libraries },
    })
}

pub(super) fn parse(bytes: &[u8]) -> PackResult<Manifest> {
    let raw: RawManifest =
        serde_json::from_slice(bytes).map_err(|e| PackIssue::new("manifest_invalid", format!("vibeloader.json ist kein gültiges Pack-Manifest: {e}")).with("detail", e))?;
    validate(raw)
}
