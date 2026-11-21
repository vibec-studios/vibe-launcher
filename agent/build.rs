use std::fmt::Write as _;
use std::path::Path;

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dist = root.join("panel-dist");
    let placeholder = root.join("panel-placeholder");
    println!("cargo:rerun-if-changed={}", dist.display());
    println!("cargo:rerun-if-changed={}", placeholder.display());
    let mut files = Vec::new();
    if dist.join("index.html").is_file() {
        collect(&dist, &dist, &mut files);
    } else {
        collect(&placeholder, &placeholder, &mut files);
    }
    files.sort();
    let mut out = String::from("pub static PANEL_FILES: &[(&str, &[u8])] = &[\n");
    for (rel, abs) in files {
        println!("cargo:rerun-if-changed={abs}");
        let _ = writeln!(out, "    ({rel:?}, include_bytes!({abs:?})),");
    }
    out.push_str("];\n");
    let dest = Path::new(&std::env::var("OUT_DIR").unwrap()).join("panel_files.rs");
    std::fs::write(dest, out).unwrap();
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(root, &p, out);
        } else if let Ok(rel) = p.strip_prefix(root) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            out.push((rel, p.to_string_lossy().to_string()));
        }
    }
}
