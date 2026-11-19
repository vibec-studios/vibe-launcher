//! Bedrock-Add-ons von CurseForge. Spiel-ID und Klassen (Add-ons, Karten, Texturen …) werden über die API
//! ermittelt (`/games`, `/categories?classesOnly=true`) – nichts fest verdrahtet außer einer Rückfall-ID.
use crate::content::curseforge::{self as cf, CfData, CfFile, CfMod, CfPage};
use crate::content::{SearchResult, SortOrder};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};

/// Bekannte Spiel-ID von „Minecraft Bedrock“, falls `/games` sie nicht liefert.
pub const FALLBACK_GAME_ID: u32 = 78022;
pub const GAME_SLUG: &str = "minecraft-bedrock";

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct CfGame {
    id: u32,
    slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CfClass {
    pub id: u32,
    pub name: String,
    pub slug: String,
}

/// Spiel-ID über `/games` (gecacht über die HTTP-Schicht).
pub async fn game_id(state: &AppState) -> AppResult<u32> {
    let r: CfPage<CfGame> = cf::get(state, "/games?index=0&pageSize=50").await?;
    Ok(r.data.iter().find(|g| g.slug == GAME_SLUG).map(|g| g.id).unwrap_or(FALLBACK_GAME_ID))
}

/// Bevorzugte Reihenfolge der Klassen in der Oberfläche.
const ORDER: &[&str] = &["addons", "texture-packs", "maps", "skins", "scripts"];

pub fn sort_classes(mut v: Vec<CfClass>) -> Vec<CfClass> {
    v.sort_by_key(|c| (ORDER.iter().position(|s| *s == c.slug).unwrap_or(ORDER.len()), c.name.to_lowercase()));
    v
}

pub async fn classes(state: &AppState) -> AppResult<Vec<CfClass>> {
    let gid = game_id(state).await?;
    let r: CfData<Vec<CfClass>> = cf::get(state, &format!("/categories?gameId={gid}&classesOnly=true")).await?;
    Ok(sort_classes(r.data))
}

pub fn search_query(game: u32, class_id: Option<u32>, query: &str, sort: SortOrder, offset: u32, limit: u32) -> String {
    let mut q = format!(
        "/mods/search?gameId={game}&sortField={}&sortOrder=desc&index={}&pageSize={}",
        cf::sort_field(sort, !query.trim().is_empty()),
        offset.min(9_950),
        limit.clamp(1, 50)
    );
    if let Some(c) = class_id {
        q.push_str(&format!("&classId={c}"));
    }
    if !query.trim().is_empty() {
        q.push_str(&format!("&searchFilter={}", urlencoding::encode(query.trim())));
    }
    q
}

pub async fn search(state: &AppState, query: &str, class_id: Option<u32>, sort: SortOrder, offset: u32, limit: u32) -> AppResult<SearchResult> {
    let gid = game_id(state).await?;
    let r: CfPage<CfMod> = cf::get(state, &search_query(gid, class_id, query, sort, offset, limit)).await?;
    Ok(SearchResult { hits: r.data.iter().map(cf::mod_to_hit).collect(), total: r.pagination.total_count.min(10_000), offset, limit: limit.clamp(1, 50) })
}

/// Beste Datei eines Projekts: neueste verfügbare Release-Datei, sonst neueste überhaupt.
pub fn pick_file(mut files: Vec<CfFile>) -> Option<CfFile> {
    files.retain(|f| f.is_available != Some(false) && !f.locked());
    cf::sort_files(&mut files);
    files.iter().find(|f| f.release_type == 1).cloned().or_else(|| files.first().cloned())
}

/// Datei herunterladen und in die Instanz importieren.
pub async fn install(state: &AppState, instance_id: &str, project_id: &str, file_id: Option<&str>, task: &crate::tasks::TaskHandle) -> AppResult<super::packs::ImportResult> {
    let m = cf::raw_mod(state, project_id).await?;
    let file = match file_id {
        Some(fid) => cf::raw_file(state, project_id, fid).await?,
        None => {
            let files = cf::raw_files(state, project_id, None, None).await?;
            match pick_file(files) {
                Some(f) => f,
                None if cf::manual_only(&m) => {
                    return Err(AppError::Invalid(format!("Der Autor von „{}“ erlaubt den Download nur auf curseforge.com.", m.name)));
                }
                None => return Err(AppError::NotFound(format!("Keine herunterladbare Datei für „{}“", m.name))),
            }
        }
    };
    let url = file.download_url.clone().filter(|u| !u.is_empty()).ok_or_else(|| AppError::Invalid(format!("Der Autor von „{}“ erlaubt den Download nur auf curseforge.com.", m.name)))?;
    task.stage(format!("{} wird geladen …", m.name), None);
    let tmp = state.paths.tmp().join(format!("bedrock-{}-{}", file.id, uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(state.paths.tmp())?;
    let item = crate::net::DownloadItem::new(url, tmp.clone()).sha1(file.sha1()).size(Some(file.file_length).filter(|n| *n > 0));
    let tc = task.cancel_token();
    let total = file.file_length.max(1);
    let done = std::sync::atomic::AtomicU64::new(0);
    let on = |n: u64| {
        let d = done.fetch_add(n, std::sync::atomic::Ordering::Relaxed) + n;
        task.progress(d as f64 / total as f64);
    };
    state.net.download(&item, Some(&on), Some(&tc)).await?;
    task.stage(format!("{} wird installiert …", m.name), None);
    let src = super::packs::PackSource { project_id: m.id.to_string(), file_id: file.id.to_string(), title: Some(m.name.clone()) };
    let r = super::import_file(state, instance_id, &tmp, Some(src)).await;
    let _ = std::fs::remove_file(&tmp);
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_and_class_order() {
        let q = search_query(78022, Some(4984), "  mob addon ", SortOrder::Relevance, 0, 100);
        assert!(q.starts_with("/mods/search?gameId=78022&sortField=1&sortOrder=desc&index=0&pageSize=50"));
        assert!(q.contains("&classId=4984"));
        assert!(q.contains("&searchFilter=mob%20addon"));
        let q = search_query(78022, None, "", SortOrder::Downloads, 20, 20);
        assert!(q.contains("sortField=6") && !q.contains("classId") && !q.contains("searchFilter"));
        let c = |slug: &str| CfClass { id: 1, name: slug.to_uppercase(), slug: slug.into() };
        let sorted = sort_classes(vec![c("scripts"), c("zzz"), c("maps"), c("addons")]);
        assert_eq!(sorted.iter().map(|c| c.slug.as_str()).collect::<Vec<_>>(), vec!["addons", "maps", "scripts", "zzz"]);
        let games: CfPage<CfGame> = serde_json::from_str(r#"{"data":[{"id":432,"slug":"minecraft"},{"id":78022,"slug":"minecraft-bedrock"}],"pagination":{}}"#).unwrap();
        assert_eq!(games.data.iter().find(|g| g.slug == GAME_SLUG).map(|g| g.id), Some(78022));
    }

    #[test]
    fn picks_newest_release_with_download() {
        let f = |id: u64, date: &str, rt: u32, url: Option<&str>| CfFile { id, file_date: date.into(), release_type: rt, download_url: url.map(str::to_string), ..Default::default() };
        let files = vec![f(1, "2024-01-01", 1, Some("u")), f(2, "2025-01-01", 2, Some("u")), f(3, "2025-06-01", 1, None), f(4, "2024-06-01", 1, Some("u"))];
        assert_eq!(pick_file(files).map(|f| f.id), Some(4));
        assert_eq!(pick_file(vec![f(5, "2024", 3, Some("u"))]).map(|f| f.id), Some(5));
        assert!(pick_file(vec![f(6, "2024", 1, None)]).is_none());
    }
}
