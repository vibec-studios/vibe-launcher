//! Pfad-Sandbox des Datei-Bereichs. Jeder Pfad kommt relativ zur Wurzel (Spiel- bzw. Serverordner) mit `/`
//! und wird hier geprüft, bevor irgendetwas auf der Platte passiert:
//!
//! - keine absoluten Pfade, Laufwerksbuchstaben, UNC-Pfade, `:` (auch keine NTFS-Datenströme `datei:strom`)
//! - kein `..`, keine Steuerzeichen, keine Namen mit Punkt/Leerzeichen am Ende, keine reservierten
//!   Windows-Namen (`CON`, `NUL`, `COM1` …)
//! - kein Bestandteil darf ein Symlink oder (Windows) ein Reparse-Point/Junction sein
//! - der kanonische Pfad (bzw. der des Elternordners bei neuen Dateien) liegt innerhalb der kanonischen Wurzel
//! - geschützte Einträge der Wurzel (z. B. `vibe-server.json`) sind weder sichtbar noch erreichbar
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

fn invalid(msg: &str) -> AppError {
    AppError::Invalid(msg.to_string())
}

const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "com0", "lpt1", "lpt2", "lpt3",
    "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9", "lpt0", "conin$", "conout$",
];

/// Einzelnen Datei-/Ordnernamen prüfen (für Neu anlegen und Umbenennen; strenger als Pfadbestandteile).
pub fn check_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(invalid("Bitte einen Namen eingeben"));
    }
    if name.chars().count() > 200 {
        return Err(invalid("Der Name ist zu lang"));
    }
    if let Some(c) = name.chars().find(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()) {
        return Err(AppError::Invalid(format!("Das Zeichen „{}“ ist in Namen nicht erlaubt", c.escape_default())));
    }
    check_component(name, true)
}

/// Gemeinsame Regeln für jeden Pfadbestandteil. `portable`: auch die Windows-Regeln anwenden
/// (für neue Namen immer; für vorhandene Pfade nur unter Windows, wo sie sonst auf andere Dateien zeigen).
fn check_component(c: &str, portable: bool) -> AppResult<()> {
    if c.chars().any(|ch| ch.is_control()) {
        return Err(invalid("Steuerzeichen sind in Pfaden nicht erlaubt"));
    }
    if !portable {
        return Ok(());
    }
    // Windows entfernt Punkte/Leerzeichen am Ende („...“, „datei. “) – das würde auf eine andere Datei zeigen
    if c.ends_with('.') || c.ends_with(' ') {
        return Err(invalid("Namen dürfen nicht mit Punkt oder Leerzeichen enden"));
    }
    let stem = c.split('.').next().unwrap_or(c).trim_end().to_ascii_lowercase();
    if RESERVED.contains(&stem.as_str()) {
        return Err(invalid("Reservierter Gerätename (z. B. CON, NUL, COM1)"));
    }
    Ok(())
}

/// Relativen Pfad prüfen und in Bestandteile zerlegen (ohne Dateisystemzugriff). Leer = Wurzel.
pub fn normalize(rel: &str) -> AppResult<Vec<String>> {
    if rel.contains('\0') {
        return Err(invalid("Ungültiger Pfad"));
    }
    let r = rel.replace('\\', "/");
    if r.starts_with('/') || r.contains(':') {
        return Err(invalid("Absolute Pfade sind nicht erlaubt"));
    }
    let mut parts = Vec::new();
    for c in r.split('/') {
        match c {
            "" | "." => {}
            ".." => return Err(invalid("„..“ ist in Pfaden nicht erlaubt")),
            c => {
                check_component(c, cfg!(windows))?;
                parts.push(c.to_string());
            }
        }
    }
    Ok(parts)
}

/// Ist das Element ein Symlink oder (Windows) irgendein Reparse-Point (Junction, Mount-Point …)?
pub fn is_link(m: &std::fs::Metadata) -> bool {
    if m.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// Wurzel eines Datei-Bereichs.
#[derive(Debug, Clone)]
pub struct Sandbox {
    /// Spiel- bzw. Serverordner (muss existieren)
    pub root: PathBuf,
    /// Namen direkt in der Wurzel, die verborgen und gesperrt sind (Kleinschreibung)
    pub hidden: Vec<String>,
}

/// Geprüfter Pfad.
#[derive(Debug, Clone)]
pub struct Resolved {
    /// Absoluter Pfad (unterhalb der kanonischen Wurzel)
    pub abs: PathBuf,
    /// Normierter relativer Pfad mit `/` (leer = Wurzel)
    pub rel: String,
    pub exists: bool,
}

impl Resolved {
    pub fn is_root(&self) -> bool {
        self.rel.is_empty()
    }
    pub fn parent_rel(&self) -> String {
        match self.rel.rfind('/') {
            Some(i) => self.rel[..i].to_string(),
            None => String::new(),
        }
    }
}

impl Sandbox {
    pub fn new(root: PathBuf, hidden: &[&str]) -> Self {
        Sandbox { root, hidden: hidden.iter().map(|s| s.to_ascii_lowercase()).collect() }
    }

    /// Verborgener Eintrag direkt in der Wurzel?
    pub fn is_hidden_top(&self, name: &str) -> bool {
        let n = name.to_lowercase();
        self.hidden.iter().any(|h| *h == n)
    }

    pub fn canon_root(&self) -> AppResult<PathBuf> {
        self.root.canonicalize().map_err(|_| AppError::NotFound("Ordner".into()))
    }

    /// Pfad vollständig prüfen. `allow_root`: darf der Pfad die Wurzel selbst sein (Auflisten, Importziel)?
    pub fn resolve(&self, rel: &str, allow_root: bool) -> AppResult<Resolved> {
        let parts = normalize(rel)?;
        if parts.is_empty() && !allow_root {
            return Err(invalid("Der Hauptordner selbst kann so nicht verwendet werden"));
        }
        if let Some(first) = parts.first() {
            if self.is_hidden_top(first) {
                return Err(invalid("Diese Datei wird vom Launcher verwaltet und ist geschützt"));
            }
        }
        let root = self.canon_root()?;
        let mut cur = root.clone();
        let mut exists = true;
        for (i, p) in parts.iter().enumerate() {
            cur.push(p);
            let last = i + 1 == parts.len();
            match std::fs::symlink_metadata(&cur) {
                Ok(m) => {
                    if is_link(&m) {
                        return Err(invalid("Verknüpfungen (Symlinks/Junctions) werden nicht geöffnet"));
                    }
                    if !last && !m.is_dir() {
                        return Err(AppError::NotFound(format!("Ordner {}", parts[..=i].join("/"))));
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    if !last {
                        return Err(AppError::NotFound(format!("Ordner {}", parts[..=i].join("/"))));
                    }
                    exists = false;
                }
                Err(e) => return Err(e.into()),
            }
        }
        // Zweite Absicherung: kanonisch innerhalb der Wurzel (fängt alles ab, was die Einzelprüfung übersieht)
        let check = if exists { cur.canonicalize()? } else { cur.parent().unwrap_or(&root).canonicalize()? };
        if !check.starts_with(&root) {
            return Err(invalid("Pfad außerhalb des erlaubten Ordners"));
        }
        Ok(Resolved { abs: cur, rel: parts.join("/"), exists })
    }

    /// Wie `resolve`, das Ziel muss aber existieren.
    pub fn existing(&self, rel: &str, allow_root: bool) -> AppResult<Resolved> {
        let r = self.resolve(rel, allow_root)?;
        if !r.exists {
            return Err(AppError::NotFound(if r.rel.is_empty() { "Ordner".into() } else { r.rel }));
        }
        Ok(r)
    }

    /// Relativer Pfad (mit `/`) eines absoluten Pfads unterhalb der kanonischen Wurzel.
    pub fn rel_of(&self, canon_root: &Path, abs: &Path) -> Option<String> {
        abs.strip_prefix(canon_root).ok().map(|p| p.to_string_lossy().replace('\\', "/"))
    }
}

/// `\\?\C:\…` (kanonische Windows-Pfade) in die normale Schreibweise für Explorer/Anzeige umwandeln.
pub fn plain(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        if rest.len() >= 2 && rest.as_bytes()[1] == b':' {
            return PathBuf::from(rest);
        }
    }
    p.to_path_buf()
}
