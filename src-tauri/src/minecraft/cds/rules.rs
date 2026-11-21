use crate::instance::LoaderKind;

pub struct Inputs<'a> {
    pub loader: LoaderKind,
    pub major: u32,
    pub version: &'a str,
    pub user_jvm: &'a [String],
    pub max_mem_mb: u32,
    pub path_has_space: bool,
}

const USER_FLAGS: [&str; 5] = ["-Xshare", "SharedArchiveFile", "ArchiveClassesAtExit", "AOTCache", "UseCompressedOops"];

fn update_of(version: &str) -> u32 {
    version.split(['.', '+', '-', '_']).nth(2).and_then(|s| s.parse().ok()).unwrap_or(0)
}

pub fn space_bug(major: u32, version: &str) -> bool {
    major < 21 || (major == 21 && update_of(version) < 11)
}

pub fn blocked(i: &Inputs) -> Option<&'static str> {
    if matches!(i.loader, LoaderKind::Fabric | LoaderKind::Quilt) {
        return Some("Fabric/Quilt profitiert nicht");
    }
    if i.major < 19 {
        return Some("erst ab Java 19");
    }
    if i.user_jvm.iter().any(|a| USER_FLAGS.iter().any(|f| a.contains(f))) {
        return Some("eigene CDS-/Speicher-Optionen in den JVM-Argumenten");
    }
    if i.max_mem_mb >= 32 * 1024 {
        return Some("ab 32 GB RAM nicht unterstützt");
    }
    if i.path_has_space && space_bug(i.major, i.version) {
        return Some("diese Java-Version unterstützt keine Leerzeichen im Datenpfad");
    }
    None
}
