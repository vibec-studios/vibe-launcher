use super::*;

// ------------------------------------------------------------------ Auflösung (rein, testbar)

/// Warum ein Projekt für eine Instanz nicht passt.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    /// Mod in einer Vanilla-Instanz
    NeedsLoader,
    /// Gibt es (für diese Minecraft-Version) nur für andere Loader
    OtherLoader,
    /// Gibt es für diesen Loader, aber nicht für diese Minecraft-Version
    OtherMc,
    /// Projekt ohne Dateien
    NoFiles,
    /// Projekt nicht (mehr) gefunden
    NotFound,
    /// CurseForge ist nicht eingerichtet
    NeedsCurseforge,
    /// Modpacks werden als eigene Instanz installiert
    Modpack,
    /// Abfrage fehlgeschlagen (Netzwerk o. Ä.)
    Failed,
}

#[derive(Debug, Clone)]
pub enum Resolution {
    Ok(ProjectVersion),
    Unavailable {
        reason: Reason,
        /// Loader, für die es das Projekt gibt (bei `OtherLoader`)
        loaders: Vec<String>,
        /// Unterstützte Minecraft-Versionen mit diesem Loader (älteste, neueste)
        mc_range: Option<(String, String)>,
        /// Neueste Version für eine ältere Minecraft-Version (nur auf ausdrücklichen Wunsch) + deren MC-Version
        older: Option<(ProjectVersion, String)>,
    },
}

pub(super) fn unavailable(reason: Reason) -> Resolution {
    Resolution::Unavailable { reason, loaders: vec![], mc_range: None, older: None }
}

/// Höchste mit dem Loader kompatible MC-Version einer Datei, die älter als `mc` ist.
pub(super) fn best_older_mc(v: &ProjectVersion, pt: ProjectType, mc: &str, loader: LoaderKind) -> Option<String> {
    v.game_versions
        .iter()
        .filter(|g| mc_cmp(g, mc) == Some(Ordering::Less) && provider::compatible(v, pt, g, loader))
        .max_by(|a, b| mc_cmp(a, b).unwrap_or(Ordering::Equal))
        .cloned()
}

/// Passende Version aus allen Versionen eines Projekts bestimmen – oder begründen, warum es keine gibt.
pub fn classify(all: &[ProjectVersion], pt: ProjectType, mc: &str, loader: LoaderKind) -> Resolution {
    if pt == ProjectType::Modpack {
        return unavailable(Reason::Modpack);
    }
    if all.is_empty() {
        return unavailable(Reason::NoFiles);
    }
    let ok: Vec<ProjectVersion> = all.iter().filter(|v| provider::compatible(v, pt, mc, loader)).cloned().collect();
    let pref = provider::modrinth_loaders(pt, loader, mc).map(|(a, _)| a);
    if let Some(v) = provider::pick_best(&ok, pref.as_deref()) {
        return Resolution::Ok(v);
    }
    let loader_ok = |v: &ProjectVersion| v.game_versions.iter().any(|g| provider::compatible(v, pt, g, loader));
    let for_loader: Vec<&ProjectVersion> = all.iter().filter(|v| loader_ok(v)).collect();
    // Unterstützte (Release-)Versionen mit diesem Loader
    let mut mcs: Vec<String> = for_loader
        .iter()
        .flat_map(|v| v.game_versions.iter().filter(|g| mc_key(g).is_some() && provider::compatible(v, pt, g, loader)).cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    sort_mc_desc(&mut mcs);
    let mc_range = (!mcs.is_empty()).then(|| (mcs.last().cloned().unwrap_or_default(), mcs[0].clone()));
    // Ältere Minecraft-Version: höchste ältere, dann Release vor Beta, dann neueste
    let older = for_loader
        .iter()
        .filter_map(|v| best_older_mc(v, pt, mc, loader).map(|g| (*v, g)))
        .max_by(|(va, ga), (vb, gb)| {
            mc_cmp(ga, gb)
                .unwrap_or(Ordering::Equal)
                .then_with(|| (va.release_type == "release").cmp(&(vb.release_type == "release")))
                .then_with(|| va.date.cmp(&vb.date))
        })
        .map(|(v, g)| (v.clone(), g));
    let loaders_of = |vs: Vec<&ProjectVersion>| -> Vec<String> {
        let mut l: Vec<String> = vs.iter().flat_map(|v| v.loaders.iter().cloned()).filter(|l| l != "minecraft").collect::<BTreeSet<_>>().into_iter().collect();
        l.sort_by_key(|x| ["fabric", "quilt", "neoforge", "forge", "datapack"].iter().position(|k| k == x).unwrap_or(99));
        l
    };
    let for_mc: Vec<&ProjectVersion> = all.iter().filter(|v| v.game_versions.iter().any(|g| g == mc)).collect();
    let (reason, loaders) = if pt == ProjectType::Mod && loader == LoaderKind::Vanilla {
        (Reason::NeedsLoader, loaders_of(for_mc))
    } else if !for_mc.is_empty() {
        (Reason::OtherLoader, loaders_of(for_mc))
    } else if !for_loader.is_empty() {
        (Reason::OtherMc, vec![])
    } else {
        (Reason::OtherLoader, loaders_of(all.iter().collect()))
    };
    Resolution::Unavailable { reason, loaders, mc_range, older }
}

/// Bekannte Ersatzprojekte (Modrinth-Slugs) für denselben Zweck auf anderen Loadern.
pub(super) const ALTERNATIVES: &[(&str, &[&str])] = &[
    ("sodium", &["embeddium"]),
    ("embeddium", &["sodium"]),
    ("rubidium", &["embeddium", "sodium"]),
    ("iris", &["oculus"]),
    ("oculus", &["iris"]),
    ("lithium", &["canary", "radium"]),
    ("modmenu", &["catalogue"]),
    ("catalogue", &["modmenu"]),
];

/// Mods, von denen nur einer gleichzeitig laufen sollte (Mod-IDs bzw. Modrinth-Slugs).
pub(super) const CONFLICT_GROUPS: &[&[&str]] = &[&["sodium", "embeddium", "rubidium", "optifine", "optifabric"], &["iris", "oculus", "optifine", "optifabric"]];

/// Namen der installierten Mods, mit denen sich `slug` laut den bekannten Gruppen beißt.
pub fn group_conflicts(slug: &str, installed_ids: &HashSet<String>) -> Vec<String> {
    let mut out = Vec::new();
    for g in CONFLICT_GROUPS {
        if !g.contains(&slug) {
            continue;
        }
        for other in g.iter().filter(|o| **o != slug) {
            if installed_ids.contains(*other) && !out.iter().any(|x: &String| x == other) {
                out.push(other.to_string());
            }
        }
    }
    out
}

/// Ist ein Set-Eintrag schon (ohne Vibe-Zuordnung) installiert? Vergleich über Slug/Mod-ID und Namen.
pub fn same_project(e: &SetEntry, mod_ids: &HashSet<String>, names: &HashMap<String, String>) -> Option<String> {
    if let Some(slug) = &e.slug {
        let n = norm(slug);
        if n.len() >= 3 {
            if let Some(name) = names.get(&n) {
                return Some(name.clone());
            }
            if mod_ids.iter().any(|m| norm(m) == n) {
                return Some(e.title.clone());
            }
        }
    }
    let t = norm(&e.title);
    if t.len() >= 3 {
        return names.get(&t).cloned();
    }
    None
}
