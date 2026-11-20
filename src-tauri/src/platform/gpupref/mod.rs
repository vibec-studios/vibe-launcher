#[cfg(windows)]
mod win;

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

pub const HIGH_PERFORMANCE: &str = "GpuPreference=2;";

pub trait GpuPrefStore {
    fn get(&self, exe: &str) -> Option<String>;
    fn set(&self, exe: &str, value: &str) -> AppResult<()>;
    fn remove(&self, exe: &str) -> AppResult<()>;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Ledger {
    pub entries: BTreeMap<String, Option<String>>,
}

impl Ledger {
    pub fn load(file: &Path) -> Ledger {
        std::fs::read(file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }
    pub fn save(&self, file: &Path) -> AppResult<()> {
        if self.entries.is_empty() {
            let _ = std::fs::remove_file(file);
            return Ok(());
        }
        crate::util::write_json_atomic(file, self)
    }
}

pub fn enable(store: &dyn GpuPrefStore, ledger: &mut Ledger, exe: &str) -> AppResult<bool> {
    let current = store.get(exe);
    if current.as_deref() == Some(HIGH_PERFORMANCE) {
        return Ok(false);
    }
    if !ledger.entries.contains_key(exe) {
        ledger.entries.insert(exe.to_string(), current);
    }
    store.set(exe, HIGH_PERFORMANCE)?;
    Ok(true)
}

pub fn disable_all(store: &dyn GpuPrefStore, ledger: &mut Ledger) -> AppResult<usize> {
    let mut n = 0;
    for (exe, prev) in std::mem::take(&mut ledger.entries) {
        if store.get(&exe).as_deref() != Some(HIGH_PERFORMANCE) {
            continue;
        }
        match prev {
            Some(v) => store.set(&exe, &v)?,
            None => store.remove(&exe)?,
        }
        n += 1;
    }
    Ok(n)
}

fn ledger_file(paths: &crate::paths::Paths) -> std::path::PathBuf {
    paths.root.join("gpu-preferences.json")
}

#[cfg(windows)]
fn system_store() -> Option<Box<dyn GpuPrefStore>> {
    Some(Box::new(win::Registry))
}

#[cfg(not(windows))]
fn system_store() -> Option<Box<dyn GpuPrefStore>> {
    None
}

pub fn supported() -> bool {
    cfg!(windows)
}

pub fn apply_for_launch(paths: &crate::paths::Paths, enabled: bool, exe: &Path) {
    let Some(store) = system_store() else { return };
    if !enabled {
        return;
    }
    let file = ledger_file(paths);
    let mut ledger = Ledger::load(&file);
    let exe = exe.to_string_lossy().to_string();
    match enable(store.as_ref(), &mut ledger, &exe) {
        Ok(true) => {
            if let Err(e) = ledger.save(&file) {
                tracing::warn!("GPU-Vorgaben nicht speicherbar: {e}");
            }
            tracing::info!("Leistungsstarke Grafikkarte für {exe} eingestellt");
        }
        Ok(false) => {}
        Err(e) => tracing::warn!("GPU-Vorgabe für {exe} nicht setzbar: {e}"),
    }
}

pub fn revert(paths: &crate::paths::Paths) -> AppResult<usize> {
    let Some(store) = system_store() else { return Ok(0) };
    let file = ledger_file(paths);
    let mut ledger = Ledger::load(&file);
    let n = disable_all(store.as_ref(), &mut ledger)?;
    ledger.save(&file)?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Mem(Mutex<HashMap<String, String>>);

    impl GpuPrefStore for Mem {
        fn get(&self, exe: &str) -> Option<String> {
            self.0.lock().get(exe).cloned()
        }
        fn set(&self, exe: &str, value: &str) -> AppResult<()> {
            self.0.lock().insert(exe.into(), value.into());
            Ok(())
        }
        fn remove(&self, exe: &str) -> AppResult<()> {
            self.0.lock().remove(exe);
            Ok(())
        }
    }

    #[test]
    fn enable_and_revert_restores_previous() {
        let store = Mem::default();
        store.set("C:/a/java.exe", "GpuPreference=1;").unwrap();
        let mut l = Ledger::default();
        assert!(enable(&store, &mut l, "C:/a/java.exe").unwrap());
        assert!(enable(&store, &mut l, "C:/b/java.exe").unwrap());
        assert!(!enable(&store, &mut l, "C:/b/java.exe").unwrap());
        assert_eq!(store.get("C:/a/java.exe").as_deref(), Some(HIGH_PERFORMANCE));
        assert_eq!(disable_all(&store, &mut l).unwrap(), 2);
        assert_eq!(store.get("C:/a/java.exe").as_deref(), Some("GpuPreference=1;"));
        assert_eq!(store.get("C:/b/java.exe"), None);
        assert!(l.entries.is_empty());
    }

    #[test]
    fn revert_keeps_user_changes() {
        let store = Mem::default();
        let mut l = Ledger::default();
        enable(&store, &mut l, "x.exe").unwrap();
        store.set("x.exe", "GpuPreference=1;").unwrap();
        assert_eq!(disable_all(&store, &mut l).unwrap(), 0);
        assert_eq!(store.get("x.exe").as_deref(), Some("GpuPreference=1;"));
    }

    #[test]
    fn already_set_is_not_recorded() {
        let store = Mem::default();
        store.set("y.exe", HIGH_PERFORMANCE).unwrap();
        let mut l = Ledger::default();
        assert!(!enable(&store, &mut l, "y.exe").unwrap());
        assert!(l.entries.is_empty());
    }

    #[test]
    fn ledger_roundtrip() {
        let d = crate::util::testdir::TestDir::new("gpupref");
        let f = d.path().join("l.json");
        let mut l = Ledger::default();
        l.entries.insert("a".into(), None);
        l.save(&f).unwrap();
        assert_eq!(Ledger::load(&f), l);
        Ledger::default().save(&f).unwrap();
        assert!(!f.exists());
    }
}
