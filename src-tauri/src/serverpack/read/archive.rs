use super::*;

#[derive(Deserialize)]
pub(super) struct MrIndex {
    #[serde(default)]
    pub(super) files: Vec<MrIndexFile>,
}

#[derive(Deserialize)]
pub(super) struct MrIndexFile {
    pub(super) path: String,
    #[serde(default)]
    pub(super) hashes: HashMap<String, String>,
    #[serde(default)]
    pub(super) env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub(super) downloads: Vec<String>,
    #[serde(rename = "fileSize", default)]
    pub(super) file_size: Option<u64>,
}

pub(super) fn file_name(rel: &str) -> String {
    rel.rsplit('/').next().unwrap_or(rel).to_string()
}

pub(super) fn display_name(rel: &str) -> String {
    let f = file_name(rel);
    f.strip_suffix(".disabled").unwrap_or(&f).trim_end_matches(".jar").to_string()
}

pub(super) fn entry(path: String, name: Option<String>, side: Side, enabled: bool, origin: EntryOrigin, size: Option<u64>, src: EntrySrc) -> Entry {
    let include = enabled && side != Side::Client;
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| display_name(&path));
    Entry { info: PackEntry { path, name, side, enabled, include, origin, size }, src }
}

pub fn mrpack_server_files(index: &[u8]) -> AppResult<(Vec<Entry>, u32)> {
    let idx: MrIndex = serde_json::from_slice(index).map_err(|e| AppError::Invalid(format!("modrinth.index.json unlesbar: {e}")))?;
    let mut out = Vec::new();
    let mut skipped = 0u32;
    for f in idx.files {
        let env = f.env.as_ref();
        let server = env.and_then(|e| e.get("server")).map(String::as_str);
        if server == Some("unsupported") || filter::is_client_content(&f.path) {
            skipped += 1;
            continue;
        }
        if filter::classify(&f.path) == PathKind::Skip {
            continue;
        }
        let Some(url) = f.downloads.iter().find(|u| u.starts_with("https://") || u.starts_with("http://")).cloned() else { continue };
        let side = env.map(|e| csides::from_sides(e.get("client").map(String::as_str), server)).unwrap_or(Side::Unknown);
        let src = EntrySrc::Url { url, sha1: f.hashes.get("sha1").cloned(), sha512: f.hashes.get("sha512").cloned() };
        out.push(entry(f.path, None, side, true, EntryOrigin::Download, f.file_size, src));
    }
    Ok((out, skipped))
}

pub fn archive_scan(zip_path: &Path, prefixes: &[String]) -> AppResult<(Vec<(String, String, u64)>, u32, Vec<String>, u32)> {
    let f = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f))?;
    let mut mods: BTreeMap<String, (String, u64)> = BTreeMap::new();
    let mut configs: BTreeMap<String, ()> = BTreeMap::new();
    let mut skipped = 0u32;
    for prefix in prefixes {
        for i in 0..zip.len() {
            let e = zip.by_index(i)?;
            if e.is_dir() {
                continue;
            }
            let name = e.name().replace('\\', "/");
            let Some(rel) = name.strip_prefix(prefix.as_str()) else { continue };
            if rel.is_empty() || crate::util::safe_join(Path::new("base"), rel).is_none() {
                continue;
            }
            match filter::classify(rel) {
                PathKind::Mod => {
                    mods.insert(rel.to_string(), (name.clone(), e.size()));
                }
                PathKind::Config => {
                    configs.insert(rel.to_string(), ());
                }
                PathKind::Skip => {
                    if filter::is_client_content(rel) {
                        skipped += 1;
                    }
                }
            }
        }
    }
    let mut dirs: Vec<String> = configs.keys().map(|k| k.split('/').next().unwrap_or(k).to_string()).collect();
    dirs.dedup();
    let list = mods.into_iter().map(|(rel, (name, size))| (rel, name, size)).collect();
    Ok((list, configs.len() as u32, dirs, skipped))
}

pub(super) fn mod_side(s: ModSide) -> Side {
    match s {
        ModSide::Both => Side::Both,
        ModSide::Client => Side::Client,
        ModSide::Server => Side::Server,
        ModSide::Unknown => Side::Unknown,
    }
}

pub(super) fn classify_archive_jars(zip_path: &Path, jars: &[(String, String, u64)], tmp: &Path) -> Vec<(Side, Option<String>)> {
    let Ok(f) = std::fs::File::open(zip_path) else { return jars.iter().map(|_| (Side::Unknown, None)).collect() };
    let Ok(mut zip) = zip::ZipArchive::new(std::io::BufReader::new(f)) else { return jars.iter().map(|_| (Side::Unknown, None)).collect() };
    let _ = std::fs::create_dir_all(tmp);
    jars.iter()
        .enumerate()
        .map(|(i, (_, name, _))| {
            let p = tmp.join(format!("{i}.jar"));
            let ok = (|| -> std::io::Result<()> {
                let mut e = zip.by_name(name).map_err(std::io::Error::other)?;
                let mut out = std::fs::File::create(&p)?;
                std::io::copy(&mut e, &mut out)?;
                Ok(())
            })();
            let r = if ok.is_ok() {
                let (s, n) = crate::server::sides::classify(&p);
                (mod_side(s), n)
            } else {
                (Side::Unknown, None)
            };
            let _ = std::fs::remove_file(&p);
            r
        })
        .collect()
}

pub(super) fn read_zip_bytes(zip_path: &Path, name: &str) -> Option<Vec<u8>> {
    let f = std::fs::File::open(zip_path).ok()?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f)).ok()?;
    let mut e = zip.by_name(name).ok()?;
    let mut b = Vec::new();
    e.read_to_end(&mut b).ok()?;
    Some(b)
}

pub(super) fn format_name(f: PackFormat) -> &'static str {
    match f {
        PackFormat::Mrpack => "mrpack",
        PackFormat::Curseforge => "curseforge",
        PackFormat::Vlpack => "vlpack",
        PackFormat::Prism => "prism",
        PackFormat::Multimc => "multimc",
    }
}
