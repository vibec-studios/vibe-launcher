use super::*;

// ------------------------------------------------------------------ Fill-API (Paper, Folia)

#[derive(Deserialize)]
pub(super) struct FillVersions {
    pub(super) versions: Vec<FillVersionEntry>,
}



#[derive(Deserialize)]
pub(super) struct FillVersionEntry {
    pub(super) version: FillVersion,
}



#[derive(Deserialize)]
pub(super) struct FillVersion {
    pub(super) id: String,
    #[serde(default)]
    pub(super) support: Option<FillSupport>,
    #[serde(default)]
    pub(super) java: Option<FillJava>,
}



#[derive(Deserialize)]
pub(super) struct FillSupport {
    #[serde(default)]
    pub(super) status: String,
}



#[derive(Deserialize)]
pub(super) struct FillJava {
    #[serde(default)]
    pub(super) version: Option<FillJavaVersion>,
    #[serde(default)]
    pub(super) flags: Option<FillJavaFlags>,
}



#[derive(Deserialize)]
pub(super) struct FillJavaVersion {
    #[serde(default)]
    pub(super) minimum: Option<u32>,
}



#[derive(Deserialize, Default)]
pub(super) struct FillJavaFlags {
    #[serde(default)]
    pub(super) recommended: Vec<String>,
}



#[derive(Deserialize)]
pub(super) struct FillBuild {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) time: Option<String>,
    #[serde(default)]
    pub(super) channel: String,
    #[serde(default)]
    pub(super) commits: Vec<FillCommit>,
    #[serde(default)]
    pub(super) downloads: std::collections::HashMap<String, FillDownload>,
}



#[derive(Deserialize)]
pub(super) struct FillCommit {
    #[serde(default)]
    pub(super) message: String,
}



#[derive(Deserialize)]
pub(super) struct FillDownload {
    pub(super) name: String,
    #[serde(default)]
    pub(super) checksums: FillChecksums,
    #[serde(default)]
    pub(super) size: Option<u64>,
    pub(super) url: String,
}



#[derive(Deserialize, Default)]
pub(super) struct FillChecksums {
    #[serde(default)]
    pub(super) sha256: Option<String>,
}



/// Release = nur Ziffern und Punkte (26.3, 1.21.11); alles mit -pre/-rc/Buchstaben ist Vorabversion.
pub fn is_release(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_digit() || c == '.')
}



pub(super) fn first_line(s: &str) -> Option<String> {
    let l = s.lines().map(str::trim).find(|l| !l.is_empty())?;
    Some(l.chars().take(140).collect())
}



pub fn parse_fill_versions(b: &[u8]) -> AppResult<Vec<PlatformVersion>> {
    let v: FillVersions = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("PaperMC: unerwartete Antwort ({e})")))?;
    Ok(v
        .versions
        .into_iter()
        .map(|e| PlatformVersion {
            release: is_release(&e.version.id),
            supported: e.version.support.as_ref().is_some_and(|s| s.status.eq_ignore_ascii_case("SUPPORTED")),
            java_min: e.version.java.as_ref().and_then(|j| j.version.as_ref()).and_then(|v| v.minimum),
            id: e.version.id,
        })
        .collect())
}



/// Mindest-Java + empfohlene JVM-Flags einer Version (Fill `/versions/{v}`).
pub fn parse_fill_version_java(b: &[u8]) -> (Option<u32>, Vec<String>) {
    #[derive(Deserialize)]
    struct One {
        version: FillVersion,
    }
    match serde_json::from_slice::<One>(b) {
        Ok(o) => {
            let j = o.version.java;
            let min = j.as_ref().and_then(|j| j.version.as_ref()).and_then(|v| v.minimum);
            let flags = j.and_then(|j| j.flags).map(|f| f.recommended).unwrap_or_default();
            (min, flags)
        }
        Err(_) => (None, vec![]),
    }
}



pub(super) fn fill_channel(c: &str) -> BuildChannel {
    match c.to_ascii_uppercase().as_str() {
        "STABLE" | "RECOMMENDED" => BuildChannel::Stable,
        "BETA" => BuildChannel::Beta,
        _ => BuildChannel::Alpha,
    }
}



/// Builds neueste zuerst. Builds ohne Server-Download werden ausgelassen.
pub fn parse_fill_builds(b: &[u8]) -> AppResult<Vec<PlatformBuild>> {
    let list: Vec<FillBuild> = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("PaperMC: unerwartete Antwort ({e})")))?;
    let mut out: Vec<(u64, PlatformBuild)> = list
        .into_iter()
        .filter_map(|b| {
            let d = b.downloads.get("server:default").or_else(|| b.downloads.values().next())?;
            Some((
                b.id,
                PlatformBuild {
                    id: b.id.to_string(),
                    channel: fill_channel(&b.channel),
                    time: b.time.clone(),
                    summary: b.commits.first().and_then(|c| first_line(&c.message)),
                    file_name: d.name.clone(),
                    url: d.url.clone(),
                    size: d.size,
                    sha256: d.checksums.sha256.clone().map(|s| s.to_ascii_lowercase()),
                    md5: None,
                },
            ))
        })
        .collect();
    out.sort_by_key(|x| std::cmp::Reverse(x.0));
    Ok(out.into_iter().map(|(_, b)| b).collect())
}
