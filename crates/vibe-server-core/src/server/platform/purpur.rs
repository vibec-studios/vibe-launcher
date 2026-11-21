use super::*;

// ------------------------------------------------------------------ Purpur

#[derive(Deserialize)]
pub(super) struct PurpurProject {
    #[serde(default)]
    pub(super) versions: Vec<String>,
    #[serde(default)]
    pub(super) metadata: Option<PurpurMeta>,
}



#[derive(Deserialize)]
pub(super) struct PurpurMeta {
    #[serde(default)]
    pub(super) current: Option<String>,
}



#[derive(Deserialize)]
pub(super) struct PurpurDetailed {
    pub(super) builds: PurpurDetailedBuilds,
}



#[derive(Deserialize)]
pub(super) struct PurpurDetailedBuilds {
    #[serde(default)]
    pub(super) all: Vec<PurpurBuild>,
}



#[derive(Deserialize)]
pub(super) struct PurpurBuild {
    pub(super) build: String,
    #[serde(default)]
    pub(super) version: String,
    #[serde(default)]
    pub(super) result: String,
    #[serde(default)]
    pub(super) timestamp: Option<i64>,
    #[serde(default)]
    pub(super) commits: Vec<PurpurCommit>,
    #[serde(default)]
    pub(super) metadata: serde_json::Value,
    #[serde(default)]
    pub(super) md5: Option<String>,
}



#[derive(Deserialize)]
pub(super) struct PurpurCommit {
    #[serde(default)]
    pub(super) description: String,
}



/// Purpur listet älteste zuerst -> neueste zuerst zurückgeben.
pub fn parse_purpur_versions(b: &[u8]) -> AppResult<Vec<PlatformVersion>> {
    let p: PurpurProject = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("Purpur: unerwartete Antwort ({e})")))?;
    let current = p.metadata.and_then(|m| m.current);
    Ok(p
        .versions
        .into_iter()
        .rev()
        .map(|id| PlatformVersion { release: is_release(&id), supported: current.as_deref() == Some(id.as_str()), java_min: None, id })
        .collect())
}



/// `?detailed=true`-Antwort. Fehlgeschlagene Builds fallen weg; „experimental“ in den Metadaten -> Beta.
pub fn parse_purpur_builds(b: &[u8]) -> AppResult<Vec<PlatformBuild>> {
    let d: PurpurDetailed = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("Purpur: unerwartete Antwort ({e})")))?;
    let mut out: Vec<(u64, PlatformBuild)> = d
        .builds
        .all
        .into_iter()
        .filter(|b| b.result.eq_ignore_ascii_case("SUCCESS"))
        .map(|b| {
            let n: u64 = b.build.parse().unwrap_or(0);
            let experimental = b.metadata.get("type").and_then(|t| t.as_str()).is_some_and(|t| t.eq_ignore_ascii_case("experimental"));
            let time = b.timestamp.and_then(chrono::DateTime::from_timestamp_millis).map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
            (
                n,
                PlatformBuild {
                    url: format!("{PURPUR}/purpur/{}/{}/download", b.version, b.build),
                    file_name: format!("purpur-{}-{}.jar", b.version, b.build),
                    id: b.build,
                    channel: if experimental { BuildChannel::Beta } else { BuildChannel::Stable },
                    time,
                    summary: b.commits.first().and_then(|c| first_line(&c.description)),
                    size: None,
                    sha256: None,
                    md5: b.md5.map(|s| s.to_ascii_lowercase()),
                },
            )
        })
        .collect();
    out.sort_by_key(|x| std::cmp::Reverse(x.0));
    Ok(out.into_iter().map(|(_, b)| b).collect())
}
