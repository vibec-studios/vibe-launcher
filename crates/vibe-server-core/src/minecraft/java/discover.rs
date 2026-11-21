use super::*;

// ------------------------------------------------------------------ Suche

pub(super) fn push_bin_candidates(dir: &Path, out: &mut Vec<PathBuf>) {
    // dir = Sammelordner (z. B. C:\Program Files\Java) -> Unterordner mit bin/
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        for bin in [p.join("bin"), p.join("Contents/Home/bin"), p.join("jre/bin")] {
            if let Some(x) = launcher_exe(&bin) {
                out.push(x);
                break;
            }
        }
    }
}



/// Verwaltete Runtimes unter `java/`.
pub fn managed_runtimes(java_root: &Path) -> Vec<(String, PathBuf)> {
    let mut v = Vec::new();
    let Ok(rd) = std::fs::read_dir(java_root) else { return v };
    for e in rd.flatten() {
        let dir = e.path();
        if !dir.join(MARKER).is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if let Some(x) = find_bin_in(&dir) {
            v.push((name, x));
        }
    }
    v
}



pub(super) fn find_bin_in(dir: &Path) -> Option<PathBuf> {
    for bin in [dir.join("bin"), dir.join("jre.bundle/Contents/Home/bin"), dir.join("Contents/Home/bin")] {
        if let Some(x) = launcher_exe(&bin) {
            return Some(x);
        }
    }
    None
}



pub(super) fn system_candidates() -> Vec<PathBuf> {
    let mut c = Vec::new();
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        if let Some(x) = launcher_exe(&PathBuf::from(home).join("bin")) {
            c.push(x);
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for d in std::env::split_paths(&path) {
            if let Some(x) = launcher_exe(&d) {
                // Windows: "javapath"-Stubs von Oracle sind ok, werden geprüft
                c.push(x);
            }
        }
    }
    #[cfg(windows)]
    {
        let vendors = [
            "Java", "Eclipse Adoptium", "Eclipse Foundation", "AdoptOpenJDK", "Zulu", "Microsoft", "Amazon Corretto", "BellSoft",
            "Semeru", "IBM", "ojdkbuild", "RedHat", "Liberica", "SapMachine", "GraalVM",
        ];
        for root in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(pf) = std::env::var_os(root) {
                for v in vendors {
                    push_bin_candidates(&PathBuf::from(&pf).join(v), &mut c);
                }
            }
        }
        if let Some(home) = dirs::home_dir() {
            push_bin_candidates(&home.join(".jdks"), &mut c);
        }
        // Runtimes des offiziellen Minecraft-Launchers
        let mut mc_runtimes = Vec::new();
        if let Some(appdata) = dirs::data_dir() {
            mc_runtimes.push(appdata.join(".minecraft").join("runtime"));
        }
        if let Some(local) = dirs::data_local_dir() {
            mc_runtimes.push(local.join("Packages").join("Microsoft.4297127D64EC6_8wekyb3d8bbwe").join("LocalCache").join("Local").join("runtime"));
        }
        for r in mc_runtimes {
            // runtime/<component>/<platform>/<component>/bin
            if let Ok(rd) = std::fs::read_dir(&r) {
                for comp in rd.flatten() {
                    if let Ok(rd2) = std::fs::read_dir(comp.path()) {
                        for plat in rd2.flatten() {
                            if let Some(x) = find_bin_in(&plat.path().join(comp.file_name())) {
                                c.push(x);
                            }
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        push_bin_candidates(Path::new("/Library/Java/JavaVirtualMachines"), &mut c);
        if let Some(home) = dirs::home_dir() {
            push_bin_candidates(&home.join("Library/Java/JavaVirtualMachines"), &mut c);
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for d in ["/usr/lib/jvm", "/usr/lib64/jvm", "/opt/java", "/opt/jdk"] {
            push_bin_candidates(Path::new(d), &mut c);
        }
        if let Some(home) = dirs::home_dir() {
            push_bin_candidates(&home.join(".jdks"), &mut c);
            push_bin_candidates(&home.join(".sdkman/candidates/java"), &mut c);
        }
    }
    c
}



pub(super) fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}



/// Alle Java-Installationen (verwaltete zuerst, dann System; neueste Version zuerst).
pub async fn list(state: &Core) -> Vec<JavaInstall> {
    let java_root = state.paths.java_root();
    let mut cands: Vec<(PathBuf, bool)> = managed_runtimes(&java_root).into_iter().map(|(_, p)| (p, true)).collect();
    cands.extend(tokio::task::spawn_blocking(system_candidates).await.unwrap_or_default().into_iter().map(|p| (p, false)));
    let mut seen = std::collections::HashSet::new();
    let cands: Vec<(PathBuf, bool)> = cands.into_iter().filter(|(p, _)| seen.insert(canonical(p))).collect();
    let probes = futures::future::join_all(cands.into_iter().map(|(p, m)| async move { probe(&p, m).await })).await;
    let mut out: Vec<JavaInstall> = probes.into_iter().filter_map(|r| r.ok()).collect();
    // Gleiche Installation über verschiedene Pfade (z. B. Oracle-javapath) zusammenfassen
    let mut seen_v = std::collections::HashSet::new();
    out.retain(|j| j.managed || seen_v.insert((j.version.clone(), j.vendor.clone(), j.arch.clone())));
    out.sort_by(|a, b| b.managed.cmp(&a.managed).then(b.major.cmp(&a.major)).then(a.path.cmp(&b.path)));
    out
}
