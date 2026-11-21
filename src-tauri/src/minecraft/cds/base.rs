use crate::minecraft::java::{console_java, jvm_library, stamp_of};
use parking_lot::Mutex;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const MARKER: &str = ".vibe-cds";

fn marker_value(java: &Path) -> String {
    stamp_of(java).and_then(|s| serde_json::to_string(&s).ok()).unwrap_or_default()
}

pub fn archive_of(java: &Path) -> Option<PathBuf> {
    Some(jvm_library(java)?.parent()?.join("classes.jsa"))
}

pub fn ready(java: &Path) -> bool {
    let Some(jsa) = archive_of(java) else { return false };
    if !jsa.is_file() {
        return false;
    }
    match std::fs::read_to_string(jsa.with_file_name(MARKER)) {
        Ok(m) => m == marker_value(java),
        Err(_) => true,
    }
}

fn busy() -> &'static Mutex<HashSet<PathBuf>> {
    static B: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    B.get_or_init(Default::default)
}

async fn dump(java: PathBuf) -> bool {
    let mut cmd = tokio::process::Command::new(console_java(&java));
    cmd.arg("-Xshare:dump").stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(crate::minecraft::java::CREATE_NO_WINDOW);
    let ok = matches!(tokio::time::timeout(std::time::Duration::from_secs(120), cmd.status()).await, Ok(Ok(s)) if s.success());
    if let (true, Some(jsa)) = (ok, archive_of(&java)) {
        let _ = std::fs::write(jsa.with_file_name(MARKER), marker_value(&java));
    }
    ok
}

pub fn ensure_background(java: &Path, java_root: &Path) {
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    if !canon(java).starts_with(canon(java_root)) || !busy().lock().insert(java.to_path_buf()) {
        return;
    }
    let java = java.to_path_buf();
    tauri::async_runtime::spawn(async move {
        let ok = dump(java.clone()).await;
        tracing::info!("Java-Grundarchiv (CDS) für {}: {}", java.display(), if ok { "erstellt" } else { "fehlgeschlagen" });
        busy().lock().remove(&java);
    });
}
