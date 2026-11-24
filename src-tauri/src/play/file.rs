use super::*;

pub fn vibe_dir(state: &AppState, id: &str) -> PathBuf {
    state.paths.game_dir(id).join(".vibe")
}

/// Ist der Code gültig? 6–8 Zeichen aus `[a-z0-9]` ohne 0/1/i/l/o.
pub fn valid_code(code: &str) -> bool {
    (6..=8).contains(&code.len()) && code.bytes().all(|c| matches!(c, b'2'..=b'9' | b'a'..=b'h' | b'j' | b'k' | b'm' | b'n' | b'p'..=b'z'))
}

pub(super) fn loader_kind_str(i: &Instance) -> String {
    serde_json::to_value(i.loader.kind).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| "vanilla".into())
}

/// Ordner -> `kind` im Vertrag.
pub(super) fn kind_of_key(key: &str) -> Option<&'static str> {
    match key.split('/').next()? {
        "mods" => Some("mod"),
        "resourcepacks" => Some("resourcepack"),
        "shaderpacks" => Some("shader"),
        "datapacks" => Some("datapack"),
        _ => None,
    }
}

/// Vibe-Pack einer Instanz: gefolgtes/installiertes Pack (Quelle `vibe`) oder selbst geteilter Code.
pub fn vibe_pack_of(inst: &Instance, shared_code: Option<String>) -> Option<LinkVibePackRef> {
    if let Some(s) = inst.source.as_ref().filter(|s| s.kind == PackSourceKind::Vibe) {
        if let Some(code) = s.project_id.clone().filter(|c| crate::vibe::packs::valid_code(c)) {
            return Some(LinkVibePackRef { code, version_id: s.version_id.clone() });
        }
    }
    shared_code.filter(|c| crate::vibe::packs::valid_code(c)).map(|code| LinkVibePackRef { code, version_id: None })
}

/// Inhalt von `instance.json` aus Instanz, Content-Index und Client-Packs.
pub fn build_instance_file(inst: &Instance, idx: &ContentIndex, client_pack: Option<String>) -> InstanceFile {
    let pack = inst.source.as_ref().and_then(|s| {
        let source = match s.kind {
            PackSourceKind::Modrinth => "modrinth",
            PackSourceKind::Curseforge => "curseforge",
            _ => return None,
        };
        Some(LinkPack { source: source.into(), project_id: s.project_id.clone()?, version_id: s.version_id.clone()?, title: s.name.clone() })
    });
    let mut mods: Vec<LinkMod> = idx
        .files
        .iter()
        .filter(|(_, e)| matches!(e.source, Source::Modrinth | Source::Curseforge))
        .filter_map(|(k, e)| {
            Some(LinkMod {
                source: e.source.as_string(),
                project_id: e.project_id.clone(),
                version_id: Some(e.version_id.clone()).filter(|v| !v.is_empty()),
                kind: Some(kind_of_key(k)?.to_string()),
                file: if pack.is_none() { k.split_once('/').map(|(_, f)| f.to_string()) } else { None },
            })
        })
        .collect();
    // gleiche Projekte (z. B. ein Mod in zwei Dateien) nur einmal
    mods.sort_by(|a, b| (&a.source, &a.project_id).cmp(&(&b.source, &b.project_id)));
    mods.dedup_by(|a, b| a.source == b.source && a.project_id == b.project_id);
    mods.truncate(500);
    let known_files = if pack.is_none() { idx.files.keys().take(2000).cloned().collect() } else { Vec::new() };
    InstanceFile {
        schema: 1,
        name: inst.name.clone(),
        mc_version: inst.mc_version.clone(),
        loader: LinkLoader { kind: loader_kind_str(inst), version: inst.loader.version.clone().filter(|_| !inst.has_custom_loader()) },
        pack,
        mods,
        client_pack,
        vibe_pack: vibe_pack_of(inst, None),
        known_files,
    }
}

/// Client-Pack für den Vertrag: zuerst einer aus der Gruppe „Client“ (NoRisk, Essential …), sonst das erste.
pub(super) fn main_client_pack(ids: &[String]) -> Option<String> {
    ids.iter()
        .find(|id| crate::client_packs::def(id).is_some_and(|d| d.group == Some("client")))
        .or(ids.first())
        .cloned()
}

/// Vor jedem Start: `.vibe/instance.json` schreiben.
pub fn write_instance_file(state: &AppState, id: &str) -> AppResult<()> {
    let inst = state.instances.get(id)?;
    let idx = ContentIndex::load(&state.paths, id);
    let mut file = build_instance_file(&inst, &idx, main_client_pack(&crate::client_packs::installed_ids(state, id)));
    if file.vibe_pack.is_none() {
        file.vibe_pack = vibe_pack_of(&inst, crate::vibe::packs::share_link(state, id).map(|l| l.code));
    }
    crate::util::write_json_atomic(&vibe_dir(state, id).join("instance.json"), &file)
}
