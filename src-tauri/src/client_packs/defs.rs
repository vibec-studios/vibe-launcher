use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Community,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackSource {
    /// Öffentliche Download-Liste von norisk.gg
    Norisk(norisk::Flavor),
    /// Modrinth-Projekte als (Projekt-ID, Mod-IDs zur Erkennung schon vorhandener Dateien), mit Pflicht-Abhängigkeiten
    Modrinth(&'static [(&'static str, &'static [&'static str])]),
}

impl PackSource {
    pub(super) fn kind(&self) -> &'static str {
        match self {
            PackSource::Norisk(_) => "norisk",
            PackSource::Modrinth(_) => "modrinth",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PackDef {
    pub id: &'static str,
    pub category: Category,
    pub source: PackSource,
    /// Packs derselben Gruppe schließen sich gegenseitig aus
    pub group: Option<&'static str>,
    /// Unterstützte Loader (genaue Versionen liefert die Quelle)
    pub loaders: &'static [LoaderKind],
    /// Weitere Packs, die nicht zusammen mit diesem gehen (gilt in beide Richtungen)
    pub conflicts: &'static [&'static str],
    /// Herausgeber (Community-Packs: „Von …, nicht mit Vibe verbunden“)
    pub vendor: Option<&'static str>,
    pub homepage: Option<&'static str>,
}

/// Gruppe der Clients: nur einer je Instanz.
pub const GROUP_CLIENT: &str = "client";

pub static PACKS: &[PackDef] = &[
    PackDef {
        id: "norisk",
        category: Category::Community,
        source: PackSource::Norisk(norisk::Flavor::Standalone),
        group: Some(GROUP_CLIENT),
        loaders: &[LoaderKind::Fabric, LoaderKind::Forge, LoaderKind::Neoforge],
        conflicts: &[],
        vendor: Some("NoRisk"),
        homepage: Some(norisk::WEBSITE),
    },
    PackDef {
        id: "norisk-mini",
        category: Category::Community,
        source: PackSource::Norisk(norisk::Flavor::Mini),
        group: Some(GROUP_CLIENT),
        loaders: &[LoaderKind::Fabric, LoaderKind::Forge, LoaderKind::Neoforge],
        conflicts: &[],
        vendor: Some("NoRisk"),
        homepage: Some(norisk::WEBSITE),
    },
    // Modrinth-Pack: Essential (ARR, vom Autor selbst auf Modrinth veröffentlicht; Laden nur über die
    // Modrinth-API, unverändert). Bringt eigene Cosmetics/Menüs/Social mit -> Client-Gruppe.
    PackDef {
        id: "essential",
        category: Category::Community,
        source: PackSource::Modrinth(&[("k2ZPuTBm", &["essential", "essential-container"])]),
        group: Some(GROUP_CLIENT),
        loaders: &[LoaderKind::Fabric, LoaderKind::Forge, LoaderKind::Neoforge],
        conflicts: &[],
        vendor: Some("Essential (Spark Universe)"),
        homepage: Some("https://modrinth.com/mod/essential"),
    },
];

pub fn def(id: &str) -> Option<&'static PackDef> {
    PACKS.iter().find(|p| p.id == id)
}

/// Gehen zwei Packs nicht zusammen? (gleiche Gruppe oder ausdrücklicher Konflikt, symmetrisch)
pub fn excludes(a: &PackDef, b: &PackDef) -> bool {
    a.id != b.id && ((a.group.is_some() && a.group == b.group) || a.conflicts.contains(&b.id) || b.conflicts.contains(&a.id))
}

/// Installierte Packs, die vor dem Installieren von `id` entfernt werden müssen.
pub fn to_replace(id: &str, installed: &[String]) -> Vec<String> {
    let Some(d) = def(id) else { return vec![] };
    installed.iter().filter(|other| def(other).is_some_and(|o| excludes(d, o))).cloned().collect()
}
