//! Geteilte Modpacks: Instanz als `.vlpack` exportieren und hochladen (`POST /api/v1/packs`, multipart),
//! bzw. per Share-Code laden und wie eine `.vlpack`-Datei importieren.
//!
//! Die Overrides-ZIP (`overrides`-Feld) enthält den Inhalt von `overrides/` – also Pfade relativ zum
//! Spielordner (`config/…`, `mods/eigener-mod.jar`). Das Backend prüft die ZIP **nicht**; deshalb wird jede
//! heruntergeladene ZIP vor dem Import streng geprüft ([`check_overrides`]).
use super::{api_error, ensure, Feature};
use crate::content::import::{self, ImportOptions};
use crate::content::{export, ExportOptions, PackFormat};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Höchstens so viele Einträge / so viele Bytes (entpackt) in einer Overrides-ZIP.
const MAX_ENTRIES: usize = 100_000;
const MAX_UNPACKED: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareOptions {
    /// public | unlisted | friends
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub changelog: Option<String>,
    /// Vorhandenes Pack: neue Version hochladen statt neu anlegen
    #[serde(default)]
    pub code: Option<String>,
    /// Versionsnummer (Standard 1.0.0 bzw. Zeitstempel)
    #[serde(default)]
    pub version: Option<String>,
}

/// Merkt sich je Instanz den Share-Code (`instances/<id>/vibe-share.json`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ShareLink {
    pub code: String,
    pub url: Option<String>,
}

fn link_file(state: &AppState, id: &str) -> PathBuf {
    state.paths.instance_dir(id).join("vibe-share.json")
}

pub fn share_link(state: &AppState, instance_id: &str) -> Option<ShareLink> {
    std::fs::read(link_file(state, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

pub fn valid_code(code: &str) -> bool {
    (4..=16).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn tmp_path(state: &AppState, ext: &str) -> PathBuf {
    let dir = state.paths.tmp();
    let _ = std::fs::create_dir_all(&dir);
    dir.join(format!("vibe-{}.{ext}", uuid::Uuid::new_v4().simple()))
}

struct TmpFiles(Vec<PathBuf>);
impl Drop for TmpFiles {
    fn drop(&mut self) {
        for p in &self.0 {
            let _ = std::fs::remove_file(p);
        }
    }
}

// ------------------------------------------------------------------ Teilen

/// Instanz exportieren und als (neue Version eines) geteilten Packs hochladen. Liefert das `Pack` des Backends.
pub async fn share(state: &AppState, instance_id: &str, token: &str, opts: ShareOptions) -> AppResult<Value> {
    let base = ensure(state, Feature::Sharing)?;
    let inst = state.instances.get(instance_id)?;
    if let Some(c) = &opts.code {
        if !valid_code(c) {
            return Err(AppError::Invalid("Ungültiger Pack-Code".into()));
        }
    }
    let task = state.tasks.create("export", format!("{} teilen", inst.name), Some(instance_id.to_string()));
    let res = share_inner(state, &task, &base, instance_id, &inst.name, token, opts).await;
    let out = match &res {
        Ok(_) => Ok(()),
        Err(AppError::Cancelled) => Err(AppError::Cancelled),
        Err(e) => Err(AppError::msg(e.to_string())),
    };
    task.finish(out);
    res
}

async fn share_inner(state: &AppState, task: &TaskHandle, base: &str, instance_id: &str, name: &str, token: &str, opts: ShareOptions) -> AppResult<Value> {
    let vlpack = tmp_path(state, "vlpack");
    let overrides = tmp_path(state, "zip");
    let _cleanup = TmpFiles(vec![vlpack.clone(), overrides.clone()]);

    // 1. Export (gleiche Auswahl wie im Export-Dialog vorbelegt)
    let include: Vec<String> = export::entries(state, instance_id).await?.into_iter().filter(|e| e.default_selected).map(|e| e.path).collect();
    let author = super::identity(state).map(|i| i.name);
    let version = opts.version.clone().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| {
        if opts.code.is_some() {
            chrono::Local::now().format("%Y.%m.%d-%H%M").to_string()
        } else {
            "1.0.0".into()
        }
    });
    let eo = ExportOptions {
        format: PackFormat::Vlpack,
        dest: vlpack.to_string_lossy().into_owned(),
        name: name.to_string(),
        version,
        author,
        description: opts.description.clone(),
        include,
    };
    export::run_export(state.clone(), task.clone(), instance_id.to_string(), eo).await?;
    task.check()?;

    // 2. Zerlegen: Manifest, Icon, Overrides-ZIP
    task.stage("Bereite Upload vor …", Some(0.85));
    let (vp, op) = (vlpack.clone(), overrides.clone());
    let parts = tokio::task::spawn_blocking(move || split_vlpack(&vp, &op)).await??;
    task.check()?;

    // 3. Upload
    task.stage("Lade hoch …", Some(0.9));
    let mut form = reqwest::multipart::Form::new();
    if opts.code.is_none() {
        let vis = match opts.visibility.as_deref() {
            Some(v @ ("public" | "unlisted" | "friends")) => v.to_string(),
            _ => "unlisted".into(),
        };
        form = form.text("visibility", vis);
        if let Some(d) = opts.description.filter(|d| !d.trim().is_empty()) {
            form = form.text("description", d);
        }
    }
    if let Some(c) = opts.changelog.filter(|d| !d.trim().is_empty()) {
        form = form.text("changelog", c);
    }
    form = form.text("manifest", parts.manifest);
    if parts.has_overrides {
        let bytes = tokio::fs::read(&overrides).await?;
        form = form.part("overrides", reqwest::multipart::Part::bytes(bytes).file_name("overrides.zip").mime_str("application/zip")?);
    }
    if let Some((bytes, mime)) = parts.icon {
        form = form.part("icon", reqwest::multipart::Part::bytes(bytes).file_name("icon.png").mime_str(mime)?);
    }
    let url = match &opts.code {
        Some(c) => format!("{base}/api/v1/packs/{c}/versions"),
        None => format!("{base}/api/v1/packs"),
    };
    let r = state.net.client.post(url).bearer_auth(token).multipart(form).timeout(Duration::from_secs(600)).send().await?;
    let status = r.status().as_u16();
    let body = r.text().await?;
    if !(200..300).contains(&status) {
        return Err(api_error(status, &body));
    }
    let pack: Value = serde_json::from_str(&body)?;
    if let Some(code) = pack["code"].as_str() {
        let link = ShareLink { code: code.to_string(), url: pack["url"].as_str().map(str::to_string) };
        let _ = crate::util::write_json_atomic(&link_file(state, instance_id), &link);
    }
    Ok(pack)
}

struct Parts {
    manifest: String,
    icon: Option<(Vec<u8>, &'static str)>,
    has_overrides: bool,
}

/// `.vlpack` in Manifest, Icon und Overrides-ZIP (ohne `overrides/`-Präfix) zerlegen.
fn split_vlpack(vlpack: &Path, overrides_out: &Path) -> AppResult<Parts> {
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(std::fs::File::open(vlpack)?))?;
    let manifest = {
        let mut f = zip.by_name("vlpack.json").map_err(|_| AppError::msg("Export unvollständig (vlpack.json fehlt)"))?;
        let mut s = String::new();
        f.read_to_string(&mut s)?;
        s
    };
    let mv: Value = serde_json::from_str(&manifest)?;
    let icon = match mv["icon"].as_str() {
        Some(name) if !name.is_empty() => match zip.by_name(name) {
            Ok(mut f) if f.size() <= 1024 * 1024 => {
                let mut b = Vec::new();
                f.read_to_end(&mut b)?;
                image_mime(&b).map(|m| (b, m))
            }
            _ => None,
        },
        _ => None,
    };
    let mut out = zip::ZipWriter::new(std::io::BufWriter::new(std::fs::File::create(overrides_out)?));
    let mut n = 0usize;
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i)?;
        let name = f.name().replace('\\', "/");
        let Some(rel) = name.strip_prefix("overrides/") else { continue };
        if rel.is_empty() {
            continue;
        }
        let rel = rel.to_string();
        out.raw_copy_file_rename(f, rel)?;
        n += 1;
    }
    out.finish()?;
    Ok(Parts { manifest, icon, has_overrides: n > 0 })
}

pub(super) fn image_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(b"GIF8") {
        Some("image/gif")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

// ------------------------------------------------------------------ Importieren

/// Geteiltes Pack per Code als neue Instanz importieren (Task). `token` optional (öffentliche Packs).
pub async fn install(state: AppState, task: TaskHandle, code: String, version_id: Option<String>, token: Option<String>) -> AppResult<()> {
    install_from(state, task, super::pack_fetch::PackOrigin::Code { code, version_id }, token).await
}

/// Pack (per Code oder Spiel-Link) als neue Instanz importieren.
pub async fn install_from(state: AppState, task: TaskHandle, origin: super::pack_fetch::PackOrigin, token: Option<String>) -> AppResult<()> {
    let f = super::pack_fetch::fetch(&state, Some(&task), &origin, token).await?;
    task.set_title(format!("{} importieren", f.name));
    task.check()?;
    let sub = task.sub(0.1, 1.0);
    import::run_import(&state, &task, &f.vlpack, ImportOptions { name: Some(f.name.clone()), source: Some(f.source.clone()), ..Default::default() }, sub).await?;
    Ok(())
}

/// Ist ein ZIP-Eintragsname als relativer Pfad im Spielordner sicher?
pub fn safe_entry_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 512 || name.contains('\0') || name.contains('\\') {
        return false;
    }
    if name.starts_with('/') || name.contains(':') {
        return false;
    }
    let trimmed = name.trim_end_matches('/');
    if trimmed.is_empty() {
        return false;
    }
    trimmed.split('/').all(|c| {
        !c.is_empty()
            && c != "."
            && c != ".."
            // Windows: Punkte/Leerzeichen am Ende werden abgeschnitten ("..." -> "..")
            && !c.ends_with('.')
            && !c.ends_with(' ')
            && !is_reserved_windows_name(c)
    })
}

fn is_reserved_windows_name(c: &str) -> bool {
    let stem = c.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit())
}

/// Overrides-ZIP vom Backend prüfen (Zip-Slip, Symlinks, Größe). Fehler = Import abbrechen.
pub fn check_overrides(path: &Path) -> AppResult<()> {
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(std::fs::File::open(path)?)).map_err(|_| AppError::Invalid("Die Overrides des Packs sind keine gültige ZIP-Datei".into()))?;
    if zip.len() > MAX_ENTRIES {
        return Err(AppError::Invalid("Die Overrides des Packs enthalten zu viele Dateien".into()));
    }
    let mut total = 0u64;
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i)?;
        let name = f.name().to_string();
        if !safe_entry_name(&name) || f.enclosed_name().is_none() {
            return Err(AppError::Invalid(format!("Das Pack enthält einen unsicheren Pfad und wurde nicht importiert: {name}")));
        }
        if f.is_symlink() {
            return Err(AppError::Invalid(format!("Das Pack enthält eine symbolische Verknüpfung und wurde nicht importiert: {name}")));
        }
        total = total.saturating_add(f.size());
        if total > MAX_UNPACKED {
            return Err(AppError::Invalid("Die Overrides des Packs sind zu groß".into()));
        }
    }
    Ok(())
}

/// `.vlpack` aus Manifest, geprüfter Overrides-ZIP und Icon zusammensetzen.
pub(super) fn build_vlpack(dest: &Path, manifest: &str, overrides: Option<&Path>, icon: Option<&[u8]>) -> AppResult<()> {
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut out = zip::ZipWriter::new(std::io::BufWriter::new(std::fs::File::create(dest)?));
    out.start_file("vlpack.json", opts)?;
    out.write_all(manifest.as_bytes())?;
    if let Some(b) = icon {
        out.start_file("icon.png", opts)?;
        out.write_all(b)?;
    }
    if let Some(p) = overrides {
        let mut zip = zip::ZipArchive::new(std::io::BufReader::new(std::fs::File::open(p)?))?;
        // Alte Uploads mit "overrides/"-Präfix tolerieren
        let prefixed = (0..zip.len()).all(|i| zip.name_for_index(i).is_some_and(|n| n.starts_with("overrides/")));
        for i in 0..zip.len() {
            let f = zip.by_index_raw(i)?;
            let name = f.name().to_string();
            let rel = if prefixed { name.trim_start_matches("overrides/").to_string() } else { name };
            if rel.is_empty() {
                continue;
            }
            out.raw_copy_file_rename(f, format!("overrides/{rel}"))?;
        }
    }
    out.finish()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_names() {
        for ok in ["config/a.json", "mods/x.jar", "options.txt", "config/", "kubejs/server_scripts/a.js", "a..b/c"] {
            assert!(safe_entry_name(ok), "{ok}");
        }
        for bad in [
            "../evil.txt",
            "config/../../evil",
            "/etc/passwd",
            "C:/Windows/x",
            "C:evil",
            "config\\..\\..\\x",
            "a/./b",
            "a//b",
            "",
            "nul.txt",
            "COM1",
            "con",
            "x/...",
            "x/y ",
            "a\0b",
        ] {
            assert!(!safe_entry_name(bad), "{bad:?}");
        }
    }

    fn zip_with(names: &[&str]) -> PathBuf {
        let p = std::env::temp_dir().join(format!("vibe-test-{}.zip", uuid::Uuid::new_v4().simple()));
        let mut w = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        for n in names {
            w.start_file(*n, o).unwrap();
            w.write_all(b"x").unwrap();
        }
        w.finish().unwrap();
        p
    }

    #[test]
    fn overrides_check() {
        let good = zip_with(&["config/a.json", "options.txt"]);
        assert!(check_overrides(&good).is_ok());
        let bad = zip_with(&["config/a.json", "../../evil.bat"]);
        let e = check_overrides(&bad).unwrap_err().to_string();
        assert!(e.contains("unsicheren Pfad"), "{e}");
        let abs = zip_with(&["/tmp/x"]);
        assert!(check_overrides(&abs).is_err());
        for p in [good, bad, abs] {
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn roundtrip_split_build() {
        // vlpack -> split -> build -> gleiche Overrides
        let src = std::env::temp_dir().join(format!("vibe-src-{}.vlpack", uuid::Uuid::new_v4().simple()));
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&src).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            w.start_file("vlpack.json", o).unwrap();
            w.write_all(br#"{"format_version":1,"name":"T","mc_version":"1.21.1","loader":{"kind":"vanilla"},"files":[]}"#).unwrap();
            w.start_file("overrides/config/a.json", o).unwrap();
            w.write_all(b"{}").unwrap();
            w.start_file("overrides/options.txt", o).unwrap();
            w.write_all(b"fov:1").unwrap();
            w.finish().unwrap();
        }
        let ov = src.with_extension("zip");
        let parts = split_vlpack(&src, &ov).unwrap();
        assert!(parts.has_overrides);
        assert!(parts.icon.is_none());
        check_overrides(&ov).unwrap();
        let dest = src.with_extension("out.vlpack");
        build_vlpack(&dest, &parts.manifest, Some(&ov), None).unwrap();
        let mut z = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
        let mut names: Vec<String> = (0..z.len()).map(|i| z.by_index(i).unwrap().name().to_string()).collect();
        names.sort();
        assert_eq!(names, vec!["overrides/config/a.json", "overrides/options.txt", "vlpack.json"]);
        for p in [src, ov, dest] {
            let _ = std::fs::remove_file(p);
        }
    }

    #[test]
    fn codes() {
        assert!(valid_code("K7QX2M9P"));
        assert!(!valid_code("../x"));
        assert!(!valid_code("ab"));
    }
}
