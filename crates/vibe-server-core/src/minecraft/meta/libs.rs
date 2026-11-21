use super::*;

// ------------------------------------------------------------------ Libraries

/// Maven-Koordinate zerlegen: (group, artifact, version, classifier, ext)
pub fn parse_maven(coord: &str) -> Option<(String, String, String, Option<String>, String)> {
    let (c, ext) = match coord.split_once('@') {
        Some((c, e)) => (c, e.to_string()),
        None => (coord, "jar".to_string()),
    };
    let p: Vec<&str> = c.split(':').collect();
    if p.len() < 3 || p.iter().take(3).any(|s| s.is_empty()) {
        return None;
    }
    Some((p[0].to_string(), p[1].to_string(), p[2].to_string(), p.get(3).map(|s| s.to_string()), ext))
}



/// Schlüssel zum Entdoppeln: group:artifact[:classifier] (ohne Version).
pub fn library_key(name: &str) -> String {
    match parse_maven(name) {
        Some((g, a, _, c, _)) => match c {
            Some(c) => format!("{g}:{a}:{c}"),
            None => format!("{g}:{a}"),
        },
        None => name.to_string(),
    }
}



pub(super) fn join_url(base: &str, rel: &str) -> String {
    let base = base.replace("http://files.minecraftforge.net/maven", "https://maven.minecraftforge.net");
    if base.ends_with('/') { format!("{base}{rel}") } else { format!("{base}/{rel}") }
}



/// Ein aufzulösender Library-Eintrag (Datei + Herkunft).
#[derive(Debug, Clone)]
pub struct LibFile {
    pub path: PathBuf,
    /// Leer = muss lokal entstehen (Forge-Installer/Processors)
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}



impl LibFile {
    pub fn download_item(&self) -> Option<DownloadItem> {
        if self.url.is_empty() {
            return None;
        }
        Some(DownloadItem::new(&self.url, &self.path).sha1(self.sha1.clone()).size(self.size))
    }
}



impl Library {
    pub fn allowed(&self, env: &Env) -> bool {
        if !rules_allow(self.rules.as_deref(), env) {
            return false;
        }
        // Neue Natives (ab 1.19): nur die passende Architektur
        if let Some((_, _, _, Some(c), _)) = parse_maven(&self.name) {
            if let Some(rest) = c.strip_prefix("natives-") {
                let has_arm = rest.ends_with("-arm64") || rest.ends_with("-aarch64") || rest.ends_with("-aarch_64");
                let has_x86 = rest.ends_with("-x86");
                if has_arm && env.arch != "aarch64" {
                    return false;
                }
                if has_x86 && env.arch != "x86" {
                    return false;
                }
            }
        }
        true
    }

    /// Hauptartefakt (für den Klassenpfad), falls vorhanden.
    pub fn artifact(&self, libs_dir: &std::path::Path) -> Option<LibFile> {
        if let Some(a) = self.downloads.as_ref().and_then(|d| d.artifact.as_ref()) {
            let rel = match &a.path {
                Some(p) if !p.is_empty() => PathBuf::from(p),
                _ => maven_path(&self.name)?,
            };
            return Some(LibFile { path: libs_dir.join(rel), url: a.url.clone(), sha1: a.sha1.clone(), size: a.size });
        }
        // Natives-only-Einträge (alt) haben kein Hauptartefakt
        if self.natives.is_some() && self.downloads.is_some() {
            return None;
        }
        if self.natives.is_some() && self.url.is_none() {
            return None;
        }
        let rel = maven_path(&self.name)?;
        let url = join_url(self.url.as_deref().unwrap_or(LIBRARIES_URL), &rel.to_string_lossy().replace('\\', "/"));
        Some(LibFile { path: libs_dir.join(rel), url, sha1: self.sha1.clone(), size: self.size })
    }

    /// Natives-Archiv im alten Format (`natives` + Klassifizierer), falls für dieses OS vorhanden.
    pub fn native_artifact(&self, libs_dir: &std::path::Path, env: &Env) -> Option<LibFile> {
        let natives = self.natives.as_ref()?;
        let classifier = natives.get(env.os)?.replace("${arch}", env.arch_bits());
        if let Some(a) = self.downloads.as_ref().and_then(|d| d.classifiers.as_ref()).and_then(|c| c.get(&classifier)) {
            let rel = match &a.path {
                Some(p) if !p.is_empty() => PathBuf::from(p),
                _ => maven_path(&format!("{}:{classifier}", self.name))?,
            };
            return Some(LibFile { path: libs_dir.join(rel), url: a.url.clone(), sha1: a.sha1.clone(), size: a.size });
        }
        let rel = maven_path(&format!("{}:{classifier}", self.name))?;
        let url = join_url(self.url.as_deref().unwrap_or(LIBRARIES_URL), &rel.to_string_lossy().replace('\\', "/"));
        Some(LibFile { path: libs_dir.join(rel), url, sha1: None, size: None })
    }
}



// ------------------------------------------------------------------ Mergen

/// Ergebnis von `inheritsFrom`-Auflösung.
#[derive(Debug, Clone, Default)]
pub struct Resolved {
    /// ID der obersten (Kind-)Version
    pub id: String,
    /// ID der Vanilla-Basis
    pub base_id: String,
    pub kind: String,
    pub main_class: String,
    pub minecraft_arguments: Option<String>,
    pub game_args: Vec<Argument>,
    pub jvm_args: Vec<Argument>,
    pub default_user_jvm: Vec<Argument>,
    pub has_jvm_args: bool,
    /// Nach Regeln gefiltert, entdoppelt (Kind gewinnt)
    pub libraries: Vec<Library>,
    pub asset_index: Option<AssetIndexRef>,
    pub assets: Option<String>,
    pub client: Option<Artifact>,
    pub java: Option<JavaVersionRef>,
    pub logging: Option<LoggingClient>,
    /// Versions-ID, deren JAR genutzt wird (`jar`-Feld) – sonst `id`
    pub jar: Option<String>,
}
