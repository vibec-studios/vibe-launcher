use super::*;

// ------------------------------------------------------------------ Forge

pub struct ForgeIndex {
    /// Vollständige Maven-Versionen ("1.20.1-47.3.0"), Reihenfolge wie in den Metadaten
    pub versions: Vec<String>,
    pub promos: HashMap<String, String>,
}



pub async fn forge_index(state: &Core) -> AppResult<ForgeIndex> {
    let xml = fetch_cached(state, FORGE_METADATA).await.map_err(|e| AppError::msg(format!("Forge-Versionsliste nicht ladbar: {e}")))?;
    let xml = String::from_utf8_lossy(&xml);
    let re = regex::Regex::new(r"<version>([^<]+)</version>").map_err(|e| AppError::msg(e.to_string()))?;
    let versions = re.captures_iter(&xml).map(|c| c[1].trim().to_string()).collect();
    #[derive(Deserialize)]
    struct Promos {
        promos: HashMap<String, String>,
    }
    let promos = match fetch_json::<Promos>(state, FORGE_PROMOS).await {
        Ok(p) => p.promos,
        Err(e) => {
            tracing::warn!("Forge-Promotions nicht ladbar: {e}");
            HashMap::new()
        }
    };
    Ok(ForgeIndex { versions, promos })
}



/// "1.20.1-47.3.0" -> ("1.20.1", "47.3.0"); "1.7.10-10.13.4.1614-1.7.10" -> ("1.7.10", "10.13.4.1614")
pub fn split_forge_version(full: &str) -> Option<(String, String)> {
    let (mc, rest) = full.split_once('-')?;
    let rest = rest.strip_suffix(&format!("-{mc}")).unwrap_or(rest);
    // ältere Schemata: "1.10-12.18.0.2000-1.10.0"
    let rest = match rest.rsplit_once('-') {
        Some((v, suffix)) if suffix.starts_with(mc) => v,
        _ => rest,
    };
    Some((mc.to_string(), rest.to_string()))
}



/// Vollständige Maven-Version für (mc, loader-version) finden.
pub fn forge_full_version(index: Option<&ForgeIndex>, mc: &str, version: &str) -> String {
    if version.starts_with(&format!("{mc}-")) {
        return version.to_string();
    }
    if let Some(idx) = index {
        let exact = format!("{mc}-{version}");
        if idx.versions.iter().any(|v| v == &exact) {
            return exact;
        }
        let prefix = format!("{mc}-{version}-");
        if let Some(v) = idx.versions.iter().find(|v| v.starts_with(&prefix)) {
            return v.clone();
        }
    }
    format!("{mc}-{version}")
}



// ------------------------------------------------------------------ NeoForge

#[derive(Deserialize)]
pub(super) struct NeoVersions {
    #[serde(default)]
    pub(super) versions: Vec<String>,
}



/// NeoForge-Version -> Minecraft-Version.
/// Schema bis 1.21.x: `<mc-minor>.<mc-patch>.<build>` (21.1.77 -> 1.21.1, 21.0.5 -> 1.21, 20.4.80 -> 1.20.4).
/// Ab 26.x (Jahres-Versionen): `<jahr>.<drop>.<hotfix>.<build>` (26.1.0.5 -> 26.1, 26.1.2.3 -> 26.1.2).
pub fn neoforge_mc(version: &str) -> Option<String> {
    let main = version.split('-').next()?;
    let parts: Vec<&str> = main.split('.').collect();
    if parts.iter().any(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }
    let nums: Vec<u64> = parts.iter().filter_map(|p| p.parse().ok()).collect();
    let major = *nums.first()?;
    if major == 0 {
        return None; // April-Scherz-/Sonderversionen
    }
    if major >= 25 {
        // Jahres-Schema
        if nums.len() < 4 {
            // Fallback falls ohne Hotfix-Feld: 26.1.5 -> 26.1
            return Some(format!("{}.{}", nums[0], nums.get(1)?));
        }
        return Some(if nums[2] == 0 { format!("{}.{}", nums[0], nums[1]) } else { format!("{}.{}.{}", nums[0], nums[1], nums[2]) });
    }
    if nums.len() < 3 {
        return None;
    }
    Some(if nums[1] == 0 { format!("1.{}", nums[0]) } else { format!("1.{}.{}", nums[0], nums[1]) })
}



pub(super) fn is_unstable(v: &str) -> bool {
    let l = v.to_ascii_lowercase();
    l.contains("beta") || l.contains("alpha") || l.contains("-rc") || l.contains("snapshot") || l.contains("pre")
}



pub(super) async fn neo_versions(state: &Core) -> AppResult<Vec<String>> {
    let v: NeoVersions = fetch_json(state, NEO_VERSIONS).await.map_err(|e| AppError::msg(format!("NeoForge-Versionsliste nicht ladbar: {e}")))?;
    Ok(v.versions)
}



pub(super) async fn neo_forge_versions(state: &Core) -> AppResult<Vec<String>> {
    let v: NeoVersions = fetch_json(state, NEO_FORGE_VERSIONS).await?;
    Ok(v.versions)
}
