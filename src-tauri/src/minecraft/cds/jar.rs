use crate::error::AppResult;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MANIFEST: &str = "META-INF/MANIFEST.MF";

pub fn is_signature(name: &str) -> bool {
    let up = name.to_ascii_uppercase();
    let Some(rest) = up.strip_prefix("META-INF/") else { return false };
    !rest.contains('/') && (rest.starts_with("SIG-") || [".SF", ".RSA", ".DSA", ".EC"].iter().any(|e| rest.ends_with(e)))
}

fn main_class<R: Read + std::io::Seek>(z: &mut zip::ZipArchive<R>) -> Option<String> {
    let mut text = String::new();
    z.by_name(MANIFEST).ok()?.read_to_string(&mut text).ok()?;
    text.lines().find_map(|l| l.strip_prefix("Main-Class:")).map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

pub fn strip(src: &Path, dst: &Path) -> AppResult<()> {
    let mut z = zip::ZipArchive::new(std::io::BufReader::new(std::fs::File::open(src)?))?;
    let mut manifest = String::from("Manifest-Version: 1.0\r\n");
    if let Some(m) = main_class(&mut z) {
        manifest.push_str(&format!("Main-Class: {m}\r\n"));
    }
    manifest.push_str("\r\n");
    if let Some(p) = dst.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = dst.with_extension("part");
    let mut w = zip::ZipWriter::new(std::io::BufWriter::new(std::fs::File::create(&tmp)?));
    w.start_file(MANIFEST, zip::write::SimpleFileOptions::default())?;
    w.write_all(manifest.as_bytes())?;
    for i in 0..z.len() {
        let e = z.by_index_raw(i)?;
        if is_signature(e.name()) || e.name().eq_ignore_ascii_case(MANIFEST) {
            continue;
        }
        w.raw_copy_file(e)?;
    }
    w.finish()?.flush()?;
    std::fs::rename(&tmp, dst)?;
    Ok(())
}

pub fn copy_path(meta: &Path, client_jar: &Path, sha1: Option<&str>) -> Option<PathBuf> {
    let name = client_jar.file_name()?;
    let key = match sha1.filter(|s| s.len() >= 8 && s.chars().all(|c| c.is_ascii_hexdigit())) {
        Some(s) => s.to_ascii_lowercase(),
        None => {
            let m = client_jar.metadata().ok()?;
            let t = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
            format!("size-{}-{t}", m.len())
        }
    };
    Some(meta.join("cds").join(key).join(name))
}
