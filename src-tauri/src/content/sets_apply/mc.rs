use super::*;

// ------------------------------------------------------------------ Minecraft-Versionen

/// Zahlen einer Release-Version („1.21.4“ -> [1, 21, 4]). Snapshots/Pre-Releases: `None`.
pub fn mc_key(v: &str) -> Option<Vec<u64>> {
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() < 2 || parts.len() > 4 {
        return None;
    }
    parts.iter().map(|p| if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) { p.parse().ok() } else { None }).collect()
}

pub fn mc_cmp(a: &str, b: &str) -> Option<Ordering> {
    let (x, y) = (mc_key(a)?, mc_key(b)?);
    let n = x.len().max(y.len());
    for i in 0..n {
        match x.get(i).copied().unwrap_or(0).cmp(&y.get(i).copied().unwrap_or(0)) {
            Ordering::Equal => {}
            o => return Some(o),
        }
    }
    Some(Ordering::Equal)
}

pub(super) fn sort_mc_desc(v: &mut [String]) {
    v.sort_by(|a, b| mc_cmp(b, a).unwrap_or(Ordering::Equal));
}
