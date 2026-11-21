use super::*;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stamp {
    exe_len: u64,
    exe_mtime: u128,
    lib_len: u64,
    lib_mtime: u128,
}

fn file_stamp(p: &Path) -> Option<(u64, u128)> {
    let m = std::fs::metadata(p).ok()?;
    let t = m.modified().ok()?.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    Some((m.len(), t))
}

pub fn jvm_library(java: &Path) -> Option<PathBuf> {
    let bin = java.parent()?;
    let home = bin.parent()?;
    let names = ["jvm.dll", "libjvm.so", "libjvm.dylib"];
    [bin.join("server"), bin.join("client"), home.join("lib").join("server"), home.join("lib").join("client")]
        .into_iter()
        .flat_map(|d| names.iter().map(move |n| d.join(n)))
        .find(|p| p.is_file())
}

pub fn stamp_of(java: &Path) -> Option<Stamp> {
    let (exe_len, exe_mtime) = file_stamp(java)?;
    let (lib_len, lib_mtime) = jvm_library(java).and_then(|p| file_stamp(&p)).unwrap_or((0, 0));
    Some(Stamp { exe_len, exe_mtime, lib_len, lib_mtime })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    stamp: Stamp,
    java: JavaInstall,
}

#[derive(Default)]
pub struct ProbeStore {
    map: HashMap<PathBuf, Entry>,
    file: Option<PathBuf>,
}

impl ProbeStore {
    pub fn load(file: PathBuf) -> Self {
        let map: HashMap<PathBuf, Entry> = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        ProbeStore { map, file: Some(file) }
    }

    pub fn get(&self, path: &Path, stamp: &Stamp) -> Option<JavaInstall> {
        self.map.get(path).filter(|e| e.stamp == *stamp).map(|e| e.java.clone())
    }

    pub fn insert(&mut self, path: &Path, stamp: Stamp, java: JavaInstall) {
        self.map.insert(path.to_path_buf(), Entry { stamp, java });
        self.save();
    }

    fn save(&self) {
        let Some(file) = &self.file else { return };
        let Ok(bytes) = serde_json::to_vec_pretty(&self.map) else { return };
        let tmp = file.with_extension("json.tmp");
        let ok = file.parent().is_some_and(|d| std::fs::create_dir_all(d).is_ok()) && std::fs::write(&tmp, bytes).is_ok() && std::fs::rename(&tmp, file).is_ok();
        if !ok {
            tracing::debug!("Java-Cache nicht speicherbar: {}", file.display());
        }
    }
}

fn store() -> &'static Mutex<ProbeStore> {
    static C: OnceLock<Mutex<ProbeStore>> = OnceLock::new();
    C.get_or_init(Default::default)
}

pub fn use_probe_store(file: PathBuf) {
    *store().lock() = ProbeStore::load(file);
}

async fn run_probe(path: &Path) -> AppResult<(String, Option<String>, String)> {
    let java = console_java(path);
    let mut cmd = tokio::process::Command::new(&java);
    cmd.args(["-XshowSettings:properties", "-version"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = tokio::time::timeout(Duration::from_secs(15), cmd.output())
        .await
        .map_err(|_| AppError::msg(format!("Java reagiert nicht: {}", path.display())))?
        .map_err(|e| AppError::msg(format!("Java konnte nicht gestartet werden ({}): {e}", path.display())))?;
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stderr), String::from_utf8_lossy(&out.stdout));
    parse_properties(&text).ok_or_else(|| AppError::msg(format!("{} ist keine gültige Java-Installation.", path.display())))
}

pub async fn probe(path: &Path, managed: bool) -> AppResult<JavaInstall> {
    let stamp = stamp_of(path).ok_or_else(|| AppError::Invalid(format!("Java nicht gefunden: {}", path.display())))?;
    if let Some(mut j) = store().lock().get(path, &stamp) {
        j.managed = managed;
        return Ok(j);
    }
    let (version, vendor, arch) = run_probe(path).await?;
    let j = JavaInstall { path: path.to_string_lossy().to_string(), major: parse_major(&version), version, vendor, arch, managed };
    store().lock().insert(path, stamp, j.clone());
    Ok(j)
}
