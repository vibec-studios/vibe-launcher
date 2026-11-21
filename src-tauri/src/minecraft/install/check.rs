use super::assets::AssetIndex;
use std::collections::HashMap;
use std::path::Path;

const WORKERS: usize = 4;

type Wanted<'a> = HashMap<&'a str, HashMap<&'a str, u64>>;

fn wanted(idx: &AssetIndex) -> Wanted<'_> {
    let mut out: Wanted = HashMap::new();
    for o in idx.objects.values() {
        if o.hash.len() < 2 || !o.hash.is_char_boundary(2) {
            continue;
        }
        out.entry(&o.hash[..2]).or_default().insert(o.hash.as_str(), o.size);
    }
    out
}

fn missing_in(dir: &Path, want: &HashMap<&str, u64>) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else { return want.len() };
    let mut found = 0;
    for e in rd.flatten() {
        let name = e.file_name();
        let Some(size) = name.to_str().and_then(|n| want.get(n)) else { continue };
        if e.metadata().map(|m| m.is_file() && m.len() == *size).unwrap_or(false) {
            found += 1;
        }
    }
    want.len().saturating_sub(found)
}

pub(super) fn missing_assets(objects: &Path, idx: &AssetIndex) -> usize {
    let want = wanted(idx);
    let groups: Vec<(&&str, &HashMap<&str, u64>)> = want.iter().collect();
    let chunk = groups.len().div_ceil(WORKERS).max(1);
    std::thread::scope(|s| {
        let handles: Vec<_> = groups
            .chunks(chunk)
            .map(|part| s.spawn(move || part.iter().map(|(pre, w)| missing_in(&objects.join(pre), w)).sum::<usize>()))
            .collect();
        handles.into_iter().map(|h| h.join().unwrap_or(usize::MAX / WORKERS)).sum()
    })
}

#[cfg(test)]
mod tests;
