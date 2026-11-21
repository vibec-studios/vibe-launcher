use super::*;

/// Bekannte unverträgliche Paare (`conflicts.toml`) unter den aktiven Mods.
#[derive(Debug, Clone, PartialEq)]
pub struct PairHit {
    pub id: String,
    pub a_file: String,
    pub a_name: String,
    pub b_file: String,
    pub b_name: String,
    pub source: String,
}

pub(super) fn side_file(mods: &ModIndex, s: &PairSide, file_re: Option<&Regex>) -> Option<(String, String)> {
    let ver_ok = |v: Option<&str>| match &s.version {
        None => true,
        Some(want) => v.is_some_and(|v| v.starts_with(want.as_str())),
    };
    for id in &s.ids {
        if let Some(e) = mods.by_id.get(&id.to_ascii_lowercase()).and_then(|v| v.iter().find(|e| ver_ok(e.version.as_deref()))) {
            return Some((e.file.clone(), e.name.clone().unwrap_or_else(|| s.name.clone())));
        }
    }
    // Datei ohne Metadaten (OptiFine) bzw. Version im Dateinamen
    let re = file_re?;
    mods.files
        .iter()
        .find(|f| re.is_match(f) && mods.id_of_file(f).is_none() && s.version.as_ref().map(|v| f.contains(v.as_str())).unwrap_or(true))
        .map(|f| (f.clone(), s.name.clone()))
}

pub fn known_pairs(mods: &ModIndex) -> Vec<PairHit> {
    let mut out = vec![];
    for p in &table().pairs {
        let (Some((af, an)), Some((bf, bn))) = (side_file(mods, &p.raw.a, p.a_file.as_ref()), side_file(mods, &p.raw.b, p.b_file.as_ref())) else {
            continue;
        };
        if af == bf || out.iter().any(|h: &PairHit| h.a_file == af && h.b_file == bf) {
            continue;
        }
        out.push(PairHit { id: p.raw.id.clone(), a_file: af, a_name: an, b_file: bf, b_name: bn, source: p.raw.source.clone() });
    }
    out
}
