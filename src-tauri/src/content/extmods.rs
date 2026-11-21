use super::norisk::{Plan, PlanJar};
use super::ContentKind;
use std::path::Path;

fn mtime_ms(p: &Path) -> i64 {
    std::fs::metadata(p).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn added_since(game: &Path, since_ms: i64, icons: &Path) -> Vec<PlanJar> {
    let Ok(rd) = std::fs::read_dir(game.join("mods")) else { return vec![] };
    let mut files: Vec<_> = rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
    files.sort();
    files
        .into_iter()
        .filter_map(|p| {
            let name = p.file_name()?.to_string_lossy().to_string();
            let lower = name.to_ascii_lowercase();
            if !(lower.ends_with(".jar") || lower.ends_with(".jar.disabled")) || name.starts_with('.') || mtime_ms(&p) <= since_ms {
                return None;
            }
            let mod_id = super::meta::read_entry(&p, ContentKind::Mod, icons).mod_id.filter(|m| !m.is_empty());
            Some(PlanJar { path: p, name, mod_id })
        })
        .collect()
}

pub fn plan(game: &Path, since_ms: i64, icons: &Path) -> Plan {
    Plan { jars: added_since(game, since_ms, icons), ..Default::default() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_new_jars() {
        let root = std::env::temp_dir().join(format!("vl-extmods-{}", uuid::Uuid::new_v4()));
        let mods = root.join("mods");
        std::fs::create_dir_all(mods.join("sub")).unwrap();
        for n in ["alt.jar", "neu.jar", "aus.jar.disabled", "notiz.txt"] {
            std::fs::write(mods.join(n), "x").unwrap();
        }
        let old = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000);
        std::fs::File::options().write(true).open(mods.join("alt.jar")).unwrap().set_modified(old).unwrap();
        let names: Vec<String> = added_since(&root, 2_000_000, &root.join("icons")).into_iter().map(|j| j.name).collect();
        assert_eq!(names, vec!["aus.jar.disabled".to_string(), "neu.jar".to_string()]);
        std::fs::remove_dir_all(&root).ok();
    }
}
