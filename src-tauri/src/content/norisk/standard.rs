use super::{read_json, NrProfile};
use std::collections::HashSet;
use std::path::Path;

pub fn merge(root: &Path, profiles: &mut Vec<NrProfile>) {
    let mut have: HashSet<String> = profiles.iter().map(|p| p.id.clone()).collect();
    for f in ["norisk_versions.json"] {
        let Ok(m) = std::fs::metadata(root.join(f)) else { continue };
        if m.len() > 16 * 1024 * 1024 {
            continue;
        }
        let Some(list) = std::fs::read(root.join(f)).ok().and_then(|b| read_json(&b).ok()) else { continue };
        for mut p in list {
            if have.insert(p.id.clone()) {
                p.is_standard = true;
                profiles.push(p);
            }
        }
    }
}
