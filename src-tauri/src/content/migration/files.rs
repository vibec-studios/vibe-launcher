use super::{file_name, project, stale, GameVersion, Plan};
use crate::content::index::{self, ContentIndex};
use crate::content::missing;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::fs;
use std::path::{Path, PathBuf};

pub(super) struct Stage {
    dir: PathBuf,
    moves: Vec<(PathBuf, PathBuf)>,
    keep: bool,
}

impl Stage {
    pub(super) fn new(instance_dir: &Path) -> AppResult<Self> {
        let dir = instance_dir.join(format!(".version-change-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir)?;
        Ok(Self {
            dir,
            moves: vec![],
            keep: false,
        })
    }

    pub(super) fn download(&self, index: usize) -> PathBuf {
        self.dir.join(format!("download-{index}"))
    }

    fn relocate(&mut self, from: PathBuf, to: PathBuf) -> AppResult<()> {
        if to.symlink_metadata().is_ok() {
            return Err(stale());
        }
        fs::rename(&from, &to)?;
        self.moves.push((from, to));
        Ok(())
    }

    fn rollback(&mut self) -> AppResult<()> {
        self.keep = true;
        for (from, to) in self.moves.iter().rev() {
            fs::rename(to, from)?;
        }
        self.keep = false;
        Ok(())
    }
}

impl Drop for Stage {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }
}

fn inactive(name: &str) -> String {
    format!("{name}.disabled")
}

pub(super) fn commit(state: &AppState, id: &str, version: GameVersion, plan: Plan, stage: &mut Stage, dir: &Path, mut index: ContentIndex) -> AppResult<()> {
    let old_index = index.clone();
    let pending = missing::pending_mods(&state.paths, id);
    let result = (|| -> AppResult<()> {
        for (i, f) in plan.files.iter().enumerate() {
            let src = dir.join(&f.scan.file_name);
            if f.project().is_some_and(|key| plan.selected.iter().any(|s| project(&s.planned) == key)) {
                stage.relocate(src, stage.dir.join(format!("original-{i}")))?;
                index.files.remove(&f.scan.key);
                index.local.remove(&f.scan.key);
                index.pinned.remove(&f.scan.key);
            } else if f.scan.enabled {
                let mut dest = dir.join(inactive(&f.scan.file_name));
                if dest.symlink_metadata().is_ok() || f.scan.file_name.encode_utf16().count() > 240 {
                    let ext = Path::new(&f.scan.file_name).extension().and_then(|e| e.to_str()).unwrap_or("jar");
                    let base = format!("{}.{ext}", uuid::Uuid::new_v4());
                    let key = index::key("mods", &base);
                    if let Some(origin) = index.files.get(&f.scan.key) {
                        index.files.insert(key.clone(), origin.clone());
                    }
                    if f.pinned {
                        index.pinned.insert(key);
                    }
                    dest = dir.join(inactive(&base));
                }
                stage.relocate(src, dest)?;
            }
        }
        for (i, s) in plan.selected.iter().enumerate() {
            let p = &s.planned;
            let name = file_name(p);
            let key = index::key("mods", &name);
            let on_disk = if s.enabled { name } else { inactive(&name) };
            stage.relocate(stage.download(i), dir.join(on_disk))?;
            if plan.files.iter().any(|f| f.pinned && f.project() == Some(project(p))) {
                index.pinned.insert(key.clone());
            }
            index.files.insert(key, p.index_entry());
        }
        index.save(&state.paths, id)?;
        missing::replace_pending_mods(&state.paths, id, vec![])?;
        state.instances.set_game_version(id, version.mc_version, version.loader)
    })();
    if let Err(err) = result {
        let files = stage.rollback();
        let index = old_index.clone().save(&state.paths, id);
        let pending = missing::replace_pending_mods(&state.paths, id, pending);
        if let Err(rollback) = files.and(index).and(pending) {
            return Err(AppError::msg(format!(
                "{err}. Rückgängig machen fehlgeschlagen ({rollback}). Stelle den Snapshot vor dem Versionswechsel wieder her."
            )));
        }
        return Err(err);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wave3_failed_file_swap_restores_originals() {
        let temp = crate::util::testdir::TestDir::new("migration");
        let one = temp.path().join("one.jar");
        let two = temp.path().join("two.jar");
        fs::write(&one, "old").unwrap();
        fs::write(&two, "other mod").unwrap();
        let mut stage = Stage::new(temp.path()).unwrap();
        let backup = stage.dir.join("backup");
        let candidate = stage.download(0);
        fs::write(&candidate, "target").unwrap();
        stage.relocate(one.clone(), backup).unwrap();
        assert!(stage.relocate(candidate, two.clone()).is_err());
        stage.rollback().unwrap();
        assert_eq!(fs::read_to_string(one).unwrap(), "old");
        assert_eq!(fs::read_to_string(two).unwrap(), "other mod");
    }
}
