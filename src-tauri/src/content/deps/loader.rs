use super::*;

pub(super) fn builtin_ids(inst: &Instance) -> Vec<&'static str> {
    let mut v = vec!["minecraft", "java"];
    match inst.loader.kind {
        LoaderKind::Fabric => v.extend(["fabricloader", "fabric-loader", "mixinextras"]),
        LoaderKind::Quilt => v.extend(["fabricloader", "fabric-loader", "quilt_loader", "quilt_base", "mixinextras"]),
        LoaderKind::Forge => v.extend(["forge", "javafml", "lowcodefml", "fml", "mixinextras"]),
        LoaderKind::Neoforge => v.extend(["neoforge", "forge", "javafml", "lowcodefml", "fml", "mixinextras"]),
        LoaderKind::Vanilla => {}
    }
    v
}

/// Sinytra Connector lädt Fabric-Mods unter NeoForge (und Forge 1.20.1).
pub(super) fn connector_hosts(inst: &Instance) -> bool {
    inst.loader.kind == LoaderKind::Neoforge || (inst.loader.kind == LoaderKind::Forge && inst.mc_version == "1.20.1")
}

/// `connector`: Sinytra Connector ist aktiv installiert -> Fabric-Mods gelten als passend.
pub(super) fn loader_ok(inst: &Instance, meta: &LocalMeta, connector: bool) -> bool {
    let Some(l) = meta.loader.as_deref() else { return true };
    match (inst.loader.kind, l) {
        (_, "multi") => true,
        (_, "fabric") if connector && connector_hosts(inst) => true,
        (LoaderKind::Fabric, "fabric") => true,
        (LoaderKind::Quilt, "fabric" | "quilt") => true,
        (LoaderKind::Forge, "forge") => true,
        (LoaderKind::Neoforge, "neoforge") => true,
        (LoaderKind::Neoforge, "forge") => inst.mc_version == "1.20.1",
        (LoaderKind::Vanilla, _) => false,
        _ => false,
    }
}

/// Abhängigkeits-ID eines Loaders, die für diese Instanz geprüft wird (`fabricloader` nur bei Fabric –
/// Quilt-Versionen sind nicht mit Fabric-Loader-Versionen vergleichbar).
pub(super) fn loader_dep_applies(inst: &Instance, id: &str) -> bool {
    match id {
        "fabricloader" | "fabric-loader" => inst.loader.kind == LoaderKind::Fabric,
        "quilt_loader" => inst.loader.kind == LoaderKind::Quilt,
        "neoforge" => inst.loader.kind == LoaderKind::Neoforge,
        "forge" => inst.loader.kind == LoaderKind::Forge,
        _ => false,
    }
}

pub(super) const LOADER_DEP_IDS: &[&str] = &["fabricloader", "fabric-loader", "quilt_loader", "neoforge", "forge"];

/// Versionsanforderung einer aktiven Mod an den Loader der Instanz.
#[derive(Debug, Clone, PartialEq)]
pub struct LoaderReq {
    pub file: String,
    pub mod_name: String,
    pub range: String,
}

/// Alle Loader-Versionsanforderungen der aktiven Mods (auch erfüllte – für die Wahl einer neuen Version).
pub fn loader_requirements(inst: &Instance, scanned: &[Scanned]) -> Vec<LoaderReq> {
    let mut out = vec![];
    for s in scanned.iter().filter(|s| s.enabled) {
        for d in s.meta.deps.iter().filter(|d| d.kind == "required" && loader_dep_applies(inst, &d.id)) {
            let Some(r) = d.range.as_deref().map(str::trim).filter(|r| !r.is_empty() && *r != "*") else { continue };
            out.push(LoaderReq { file: s.file_name.clone(), mod_name: name_of(s), range: r.to_string() });
        }
    }
    out
}

pub(super) fn loader_label(l: &str) -> &str {
    match l {
        "fabric" => "Fabric",
        "quilt" => "Quilt",
        "forge" => "Forge",
        "neoforge" => "NeoForge",
        other => other,
    }
}
