/// Ordner im Spielordner, die zum Snapshot gehören.
pub const DIRS: &[&str] = &["mods", "resourcepacks", "shaderpacks", "datapacks", "config", "defaultconfigs", "kubejs"];
/// Einzeldateien im Spielordner.
pub const FILES: &[&str] = &["options.txt", "optionsof.txt", "optionsshaders.txt"];
/// Metadaten im Instanzordner.
pub const META: &[&str] = &["content.json", "pack.json", "modsets.json"];

/// Bereiche für Teil-Snapshots (Reihenfolge = Anzeige).
pub const SCOPES: &[&str] = &["mods", "configs", "resourcepacks", "shaderpacks", "datapacks", "options"];

pub const RESTORE_NAME: &str = "Vor Wiederherstellung";

/// Ordner eines Bereichs.
pub(super) fn scope_dirs(scope: &str) -> &'static [&'static str] {
    match scope {
        "mods" => &["mods"],
        "configs" => &["config", "defaultconfigs", "kubejs"],
        "resourcepacks" => &["resourcepacks"],
        "shaderpacks" => &["shaderpacks"],
        "datapacks" => &["datapacks"],
        _ => &[],
    }
}

/// Auswahl der Bereiche eines Snapshots. `None` = alles (auch alte Manifeste ohne Angabe).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Sel(Option<Vec<String>>);

impl Sel {
    pub fn all() -> Sel {
        Sel(None)
    }
    /// Unbekannte Bereiche werden ignoriert; alle Bereiche zusammen = vollständiger Snapshot.
    pub fn of(scopes: &[String]) -> Sel {
        let v: Vec<String> = SCOPES.iter().filter(|s| scopes.iter().any(|x| x == *s)).map(|s| s.to_string()).collect();
        if v.len() == SCOPES.len() {
            Sel(None)
        } else {
            Sel(Some(v))
        }
    }
    pub fn from_manifest(m: &Option<Vec<String>>) -> Sel {
        match m {
            None => Sel(None),
            Some(v) => Sel::of(v),
        }
    }
    pub fn has(&self, scope: &str) -> bool {
        self.0.as_ref().map_or(true, |v| v.iter().any(|s| s == scope))
    }
    pub fn is_all(&self) -> bool {
        self.0.is_none()
    }
    pub fn scopes(&self) -> Option<Vec<String>> {
        self.0.clone()
    }
    pub(super) fn dirs(&self) -> Vec<&'static str> {
        DIRS.iter().copied().filter(|d| SCOPES.iter().any(|s| self.has(s) && scope_dirs(s).contains(d))).collect()
    }
    pub(super) fn files(&self) -> &'static [&'static str] {
        if self.has("options") {
            FILES
        } else {
            &[]
        }
    }
    /// Metadaten: content.json, sobald ein Inhalte-Ordner dabei ist; pack.json/modsets.json gehören zu den Mods.
    pub(super) fn meta(&self) -> Vec<&'static str> {
        let mut v = vec![];
        if !self.content_prefixes().is_empty() {
            v.push("content.json");
        }
        if self.has("mods") {
            v.extend(["pack.json", "modsets.json"]);
        }
        v
    }
    /// Ordner, deren content.json-Einträge zum Snapshot gehören.
    pub(super) fn content_prefixes(&self) -> Vec<&'static str> {
        ["mods", "resourcepacks", "shaderpacks", "datapacks"].into_iter().filter(|d| self.dirs().contains(d)).collect()
    }
}
