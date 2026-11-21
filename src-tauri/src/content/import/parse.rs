use super::*;

pub(super) fn loader_from_mrpack(deps: &HashMap<String, String>) -> Loader {
    for (k, kind) in [("neoforge", LoaderKind::Neoforge), ("forge", LoaderKind::Forge), ("quilt-loader", LoaderKind::Quilt), ("fabric-loader", LoaderKind::Fabric)] {
        if let Some(v) = deps.get(k) {
            return Loader { kind, version: Some(v.clone()) };
        }
    }
    Loader { kind: LoaderKind::Vanilla, version: None }
}

/// CurseForge-Loader-ID (`forge-47.2.0`, `neoforge-21.1.77`, `fabric-0.15.7`, `quilt-0.25.0`) -> Loader.
pub fn loader_from_cf_id(id: &str, mc: &str) -> Loader {
    let (kind_s, ver) = id.split_once('-').unwrap_or((id, ""));
    let kind = match kind_s.to_ascii_lowercase().as_str() {
        "forge" => LoaderKind::Forge,
        "neoforge" => LoaderKind::Neoforge,
        "fabric" => LoaderKind::Fabric,
        "quilt" => LoaderKind::Quilt,
        _ => return Loader { kind: LoaderKind::Vanilla, version: None },
    };
    // Ältere NeoForge-IDs: "neoforge-1.20.1-47.1.79"
    let ver = ver.strip_prefix(&format!("{mc}-")).unwrap_or(ver);
    Loader { kind, version: Some(ver.to_string()).filter(|v| !v.is_empty()) }
}

pub fn cf_loader_id(l: &Loader) -> Option<String> {
    let v = l.version.as_deref()?;
    Some(match l.kind {
        LoaderKind::Vanilla => return None,
        LoaderKind::Forge => format!("forge-{v}"),
        LoaderKind::Neoforge => format!("neoforge-{v}"),
        LoaderKind::Fabric => format!("fabric-{v}"),
        LoaderKind::Quilt => format!("quilt-{v}"),
    })
}

/// Modrinth-CDN-URL -> (Projekt-ID, Versions-ID).
pub fn modrinth_ids_from_url(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("https://cdn.modrinth.com/data/")?;
    let mut it = rest.split('/');
    let pid = it.next()?;
    if it.next()? != "versions" {
        return None;
    }
    let vid = it.next()?;
    it.next()?;
    Some((pid.to_string(), vid.to_string()))
}

pub(super) fn check_rel(path: &str) -> AppResult<()> {
    if safe_join(Path::new("base"), path).is_none() {
        return Err(AppError::Invalid(format!("Das Pack enthält einen unzulässigen Pfad: {path}")));
    }
    Ok(())
}

/// `instance.cfg`/`prismlauncher.cfg` lesen. Werte wie Qt/Prism sie schreiben: ggf. in Anführungszeichen,
/// Escapes `\n`, `\t`, `\\`, `\"`, `\#` (MultiMC).
pub(crate) fn parse_ini(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.starts_with('[') || l.starts_with('#') || l.starts_with(';') {
                return None;
            }
            let (k, v) = l.split_once('=')?;
            Some((k.trim().to_string(), ini_unescape(v.trim())))
        })
        .collect()
}

pub(super) fn ini_unescape(v: &str) -> String {
    let v = if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') { &v[1..v.len() - 1] } else { v };
    if !v.contains('\\') {
        return v.to_string();
    }
    let mut out = String::with_capacity(v.len());
    let mut it = v.chars();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => {}
            Some(c @ ('\\' | '"' | '#' | ';' | '\'')) => out.push(c),
            // Unbekannt (z. B. Windows-Pfad mit einfachem Backslash): unverändert lassen
            Some(c) => {
                out.push('\\');
                out.push(c);
            }
            None => out.push('\\'),
        }
    }
    out
}
