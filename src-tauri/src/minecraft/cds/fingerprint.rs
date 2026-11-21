use sha1::{Digest, Sha1};
use std::path::Path;
use std::time::SystemTime;

fn stamp(p: &Path) -> String {
    match std::fs::metadata(p) {
        Ok(m) => {
            let t = m.modified().ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
            format!("{}:{t}", m.len())
        }
        Err(_) => "-".into(),
    }
}

pub fn path_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for w in args.windows(2) {
        if matches!(w[0].as_str(), "-cp" | "-classpath" | "--class-path" | "-p" | "--module-path") {
            out.push(format!("{}={}", w[0], w[1]));
        }
    }
    out
}

pub fn fingerprint(java: &str, java_version: &str, version_id: &str, main_class: &str, args: &[String]) -> String {
    let sep = if cfg!(windows) { ';' } else { ':' };
    let mut h = Sha1::new();
    for part in [java, java_version, version_id, main_class] {
        h.update(part.as_bytes());
        h.update([0]);
    }
    h.update(stamp(Path::new(java)).as_bytes());
    if let Some(lib) = crate::minecraft::java::jvm_library(Path::new(java)) {
        h.update(stamp(&lib).as_bytes());
    }
    for a in path_args(args) {
        h.update(a.as_bytes());
        let value = a.split_once('=').map(|(_, v)| v).unwrap_or("");
        for entry in value.split(sep).filter(|e| !e.is_empty()) {
            h.update(stamp(Path::new(entry)).as_bytes());
        }
    }
    h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}
