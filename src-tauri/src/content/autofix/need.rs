use super::*;

// ------------------------------------------------------------------ 1. Bedarf (rein)

/// `cause`: Index der Absturzursache in [`FixPlan::causes`], aus der der Bedarf (auch) stammt.
#[derive(Debug, Clone, PartialEq)]
pub enum Need {
    /// Fehlende Abhängigkeit (Mod-ID) suchen und installieren
    Install { dep_id: String, required_by: Vec<String>, required_files: Vec<String>, cause: Option<usize> },
    Enable { file: String, name: String, required_by: Vec<String>, cause: Option<usize> },
    Disable { file: String, name: String, reason: String, confirm: bool, alt: Option<(String, String)>, cause: Option<usize> },
    /// Passende Version suchen (falscher Loader / falsche MC-Version), sonst deaktivieren
    Swap { file: String, name: String, reason: String, cause: Option<usize> },
    /// Installierte Abhängigkeit hat eine unpassende Version -> passende Version suchen
    Update { file: String, name: String, required_by: String, cause: Option<usize> },
    /// Kaputte Config-Datei sichern und zurücksetzen (nur nach Rückfrage)
    ResetConfig { path: String, name: String, cause: Option<usize> },
    Java { major: u32, cause: Option<usize> },
    Ram { mb: u32, cause: Option<usize> },
    Unfixable(Unfixable),
}

pub(super) const LOADER_IDS: &[&str] = &["fabricloader", "fabric-loader", "forge", "neoforge", "quilt_loader"];

pub(super) fn kind_str(k: IssueKind) -> &'static str {
    match k {
        IssueKind::MissingDependency => "missing_dependency",
        IssueKind::DisabledDependency => "disabled_dependency",
        IssueKind::VersionMismatch => "version_mismatch",
        IssueKind::Incompatible => "incompatible",
        IssueKind::Duplicate => "duplicate",
        IssueKind::WrongLoader => "wrong_loader",
        IssueKind::WrongMinecraft => "wrong_minecraft",
        IssueKind::LoaderFiles => "loader_files",
    }
}

pub(super) fn display_name(file: &str) -> String {
    let b = index::strip_disabled(file);
    b.strip_suffix(".jar").unwrap_or(b).to_string()
}

pub(super) struct Acc {
    pub(super) out: Vec<Need>,
    /// Dateien, die deaktiviert werden
    pub(super) off: HashSet<String>,
    /// Dateien, die ersetzt (oder ersatzweise deaktiviert) werden
    pub(super) swapped: HashSet<String>,
}

pub(super) fn need_cause(n: &mut Need) -> Option<&mut Option<usize>> {
    match n {
        Need::Install { cause, .. }
        | Need::Enable { cause, .. }
        | Need::Disable { cause, .. }
        | Need::Swap { cause, .. }
        | Need::Update { cause, .. }
        | Need::ResetConfig { cause, .. }
        | Need::Java { cause, .. }
        | Need::Ram { cause, .. } => Some(cause),
        Need::Unfixable(u) => Some(&mut u.cause),
    }
}

impl Acc {
    pub(super) fn gone(&self, f: &str) -> bool {
        self.off.contains(f) || self.swapped.contains(f)
    }
    /// Bereits vorhandenen Bedarf für eine Datei der Absturzursache zuordnen (falls noch ohne).
    pub(super) fn tag_file(&mut self, file: &str, c: Option<usize>) {
        if c.is_none() {
            return;
        }
        for n in self.out.iter_mut() {
            let hit = matches!(n, Need::Disable { file: f, .. } | Need::Swap { file: f, .. } | Need::Update { file: f, .. } if f == file);
            if hit {
                if let Some(slot) = need_cause(n) {
                    slot.get_or_insert(c.unwrap_or_default());
                }
                return;
            }
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn disable(&mut self, file: &str, name: String, reason: &str, confirm: bool, alt: Option<(String, String)>, cause: Option<usize>) {
        if self.gone(file) {
            self.tag_file(file, cause);
            return;
        }
        self.off.insert(file.to_string());
        self.out.push(Need::Disable { file: file.into(), name, reason: reason.into(), confirm, alt, cause });
    }
    pub(super) fn swap(&mut self, file: &str, name: String, reason: &str, cause: Option<usize>) {
        if self.gone(file) {
            self.tag_file(file, cause);
            return;
        }
        self.swapped.insert(file.to_string());
        self.out.push(Need::Swap { file: file.into(), name, reason: reason.into(), cause });
    }
    pub(super) fn update(&mut self, file: &str, name: String, required_by: &str, cause: Option<usize>) {
        if self.gone(file) {
            self.tag_file(file, cause);
            return;
        }
        self.swapped.insert(file.to_string());
        self.out.push(Need::Update { file: file.into(), name, required_by: required_by.into(), cause });
    }
    pub(super) fn install(&mut self, dep_id: &str, by: Option<(&str, &str)>, cause: Option<usize>) {
        let dep = dep_id.to_ascii_lowercase();
        for n in self.out.iter_mut() {
            if let Need::Install { dep_id, required_by, required_files, cause: c } = n {
                if *dep_id == dep {
                    if let Some((name, file)) = by {
                        if !required_by.iter().any(|x| x == name) {
                            required_by.push(name.into());
                        }
                        if !file.is_empty() && !required_files.iter().any(|x| x == file) {
                            required_files.push(file.into());
                        }
                    }
                    if c.is_none() {
                        *c = cause;
                    }
                    return;
                }
            }
        }
        let (required_by, required_files) = match by {
            Some((n, f)) => (vec![n.to_string()], if f.is_empty() { vec![] } else { vec![f.to_string()] }),
            None => (vec![], vec![]),
        };
        self.out.push(Need::Install { dep_id: dep, required_by, required_files, cause });
    }
    pub(super) fn enable(&mut self, file: &str, name: String, by: Option<&str>, cause: Option<usize>) {
        for n in self.out.iter_mut() {
            if let Need::Enable { file: f, required_by, cause: c, .. } = n {
                if f == file {
                    if let Some(b) = by {
                        if !required_by.iter().any(|x| x == b) {
                            required_by.push(b.into());
                        }
                    }
                    if c.is_none() {
                        *c = cause;
                    }
                    return;
                }
            }
        }
        self.out.push(Need::Enable { file: file.into(), name, required_by: by.map(|b| vec![b.to_string()]).unwrap_or_default(), cause });
    }
    pub(super) fn unfixable(&mut self, reason: &str, name: &str, detail: Option<String>, cause: Option<usize>) {
        let u = Unfixable { reason: reason.into(), name: name.into(), detail, cause };
        if !self.out.iter().any(|n| matches!(n, Need::Unfixable(x) if x.reason == u.reason && x.name == u.name && x.detail == u.detail)) {
            self.out.push(Need::Unfixable(u));
        }
    }
}
