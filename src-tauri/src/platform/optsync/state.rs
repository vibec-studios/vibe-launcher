use super::*;

pub fn sync_root(root: &Path) -> PathBuf {
    root.join("sync")
}

/// Gemeinsamer Ordner eines Bereichs (resourcepacks | shaderpacks | screenshots).
pub fn shared_dir(root: &Path, area: &str) -> PathBuf {
    sync_root(root).join(area)
}

pub fn shared_servers(root: &Path) -> PathBuf {
    sync_root(root).join("servers.dat")
}

pub(super) fn trash_dir(root: &Path, area: &str) -> PathBuf {
    sync_root(root).join("trash").join(area)
}

pub(super) fn state_path(root: &Path, id: &str) -> PathBuf {
    sync_root(root).join("state").join(format!("{id}.json"))
}

/// Gemeldeter Konflikt (bleibt sichtbar, bis er quittiert wird).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConflictNote {
    pub at: i64,
    pub area: String,
    pub name: String,
    pub renamed: String,
}

/// Abgleichstand einer Instanz.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct InstanceState {
    /// Bereich -> Stand nach dem letzten Abgleich
    pub dirs: BTreeMap<String, syncdir::Base>,
    /// Bereits gesammelte Screenshots
    pub screenshots: BTreeSet<String>,
    pub servers: Option<syncservers::ServerBase>,
    /// Pack-Liste, die vor dem letzten Start geschrieben wurde
    pub packs_applied: Option<Vec<String>>,
    pub(super) personal: BTreeMap<String, String>,
    pub(super) command_history_base: Vec<String>,
    pub(super) options_applied: Option<BTreeMap<String, String>>,
    pub last_sync: Option<i64>,
    pub conflicts: Vec<ConflictNote>,
    /// Fehler des letzten Abgleichs (z. B. gesperrte Datei)
    pub errors: Vec<String>,
}

impl InstanceState {
    pub fn load(root: &Path, id: &str) -> InstanceState {
        std::fs::read(state_path(root, id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }
    pub fn save(&self, root: &Path, id: &str) -> AppResult<()> {
        crate::util::write_json_atomic(&state_path(root, id), self)
    }
}

/// Ein Abgleich zur Zeit (Start, Ende, „Jetzt abgleichen“, Einstellungen).
pub(super) static LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Abgleichstand vergessen (z. B. nach einer Snapshot-Wiederherstellung): der nächste Abgleich vereinigt nur und
/// löscht nichts – ein zurückgeholter alter Stand gilt nicht als „in der Instanz gelöscht“.
pub fn forget_state(root: &Path, id: &str) {
    let _g = LOCK.lock();
    forget_areas(root, id, None);
}

/// Abgleichstand einzelner Bereiche (None = alle) vergessen; Konfliktmeldungen bleiben.
pub(super) fn forget_areas(root: &Path, id: &str, areas: Option<&[String]>) {
    if !state_path(root, id).exists() {
        return;
    }
    let mut st = InstanceState::load(root, id);
    let hit = |a: &str| areas.map_or(true, |v| v.iter().any(|x| x == a));
    for a in DIR_AREAS {
        if hit(a) {
            st.dirs.remove(a);
        }
    }
    if hit("resourcepacks") {
        st.packs_applied = None;
    }
    if hit("servers") {
        st.servers = None;
    }
    if hit("screenshots") {
        st.screenshots.clear();
    }
    for area in personal::AREAS {
        if hit(area) {
            st.personal.remove(area);
        }
    }
    if hit("command_history") {
        st.command_history_base.clear();
    }
    if hit("keybinds") {
        st.options_applied = None;
    }
    if let Err(e) = st.save(root, id) {
        tracing::warn!("Sync-Stand von {id} nicht gespeichert: {e}");
    }
}

/// Einstellungen einer Instanz speichern. Abgewählte Bereiche (bzw. alles beim Abschalten) verlieren ihren
/// Abgleichstand – die Dateien bleiben in der Instanz. Gibt die Bereiche zurück, die neu dazukamen.
pub fn set_instance(root: &Path, id: &str, enabled: bool, categories: Vec<String>) -> AppResult<Vec<String>> {
    let _g = LOCK.lock();
    let p = config_path(root);
    let mut cfg = SyncConfig::load(&p);
    let old = cfg.for_instance(id);
    let now = InstanceSync { enabled, categories };
    let removed: Vec<String> = AREAS.iter().chain(&["keybinds"]).filter(|a| old.has(a) && !now.has(a)).map(|s| s.to_string()).collect();
    let added: Vec<String> = AREAS.iter().filter(|a| !old.has(a) && now.has(a)).map(|s| s.to_string()).collect();
    cfg.instances.insert(id.to_string(), now);
    cfg.save(&p)?;
    if !removed.is_empty() {
        forget_areas(root, id, Some(&removed));
    }
    Ok(added)
}
