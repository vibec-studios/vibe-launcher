//! Abhängigkeits-Check installierter Mods: fehlende Pflicht-Abhängigkeiten, falsche Versionen, Konflikte
//! (`breaks`/`incompatible`), falscher Loader / falsche Minecraft-Version, doppelte Mods. Liegt eine fehlende
//! Abhängigkeit nur deaktiviert (`.disabled`) in `mods/`, heißt die Lösung „aktivieren“ statt „installieren“.
//!
//! Versionsbereiche: Fabric/Quilt-Ausdrücke (`>=1.2 <2`, `~1.20.1`, `^1.0`, `1.20.x`, `*`, `a || b`) und
//! Maven-Bereiche aus mods.toml (`[1.20.1,1.21)`, `[47,)`). Nicht auswertbare Angaben gelten als erfüllt.
use super::index::{ContentIndex, LocalMeta};
use super::local::Scanned;
use super::{modrinth as mr, ContentKind, Source};
use crate::error::AppResult;
use crate::instance::{Instance, LoaderKind};
use crate::state::AppState;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashMap;

// ------------------------------------------------------------------ Versionen

#[derive(Debug, Clone, PartialEq)]
struct Ver {
    nums: Vec<u64>,
    pre: bool,
}

fn parse_ver(s: &str) -> Option<Ver> {
    let s = s.trim().trim_start_matches(['v', 'V']);
    let s = s.split('+').next()?;
    let (core, pre) = match s.split_once('-') {
        Some((c, p)) => (c, !p.is_empty()),
        None => (s, false),
    };
    let mut nums = Vec::new();
    for part in core.split('.') {
        let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            if nums.is_empty() {
                return None;
            }
            break;
        }
        nums.push(digits.parse().ok()?);
        if digits.len() != part.len() {
            break;
        }
    }
    if nums.is_empty() {
        return None;
    }
    Some(Ver { nums, pre })
}

fn cmp_ver(a: &Ver, b: &Ver) -> Ordering {
    let n = a.nums.len().max(b.nums.len());
    for i in 0..n {
        let x = a.nums.get(i).copied().unwrap_or(0);
        let y = b.nums.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            Ordering::Equal => {}
            o => return o,
        }
    }
    match (a.pre, b.pre) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => Ordering::Equal,
    }
}

/// Ein Fabric-Einzelausdruck (ohne Leerzeichen).
fn fabric_term(term: &str, v: &Ver) -> Option<bool> {
    let term = term.trim();
    if term.is_empty() || term == "*" {
        return Some(true);
    }
    for op in [">=", "<=", ">", "<", "=", "~", "^"] {
        if let Some(rest) = term.strip_prefix(op) {
            if rest.contains(['x', 'X', '*']) {
                return wildcard(rest, v);
            }
            let t = parse_ver(rest)?;
            let o = cmp_ver(v, &t);
            return Some(match op {
                ">=" => o != Ordering::Less,
                "<=" => o != Ordering::Greater,
                ">" => o == Ordering::Greater,
                "<" => o == Ordering::Less,
                "=" => o == Ordering::Equal,
                "~" => {
                    // gleiche Major.Minor, mindestens t
                    o != Ordering::Less && v.nums.first() == t.nums.first() && v.nums.get(1).copied().unwrap_or(0) == t.nums.get(1).copied().unwrap_or(0)
                }
                _ => o != Ordering::Less && v.nums.first() == t.nums.first(),
            });
        }
    }
    if term.contains(['x', 'X', '*']) {
        return wildcard(term, v);
    }
    let t = parse_ver(term)?;
    Some(cmp_ver(v, &t) == Ordering::Equal)
}

/// `1.20.x` – alle angegebenen Stellen müssen passen.
fn wildcard(pattern: &str, v: &Ver) -> Option<bool> {
    for (i, part) in pattern.split('.').enumerate() {
        if matches!(part, "x" | "X" | "*") {
            return Some(true);
        }
        let n: u64 = part.parse().ok()?;
        if v.nums.get(i).copied().unwrap_or(0) != n {
            return Some(false);
        }
    }
    Some(true)
}

fn maven_range(range: &str, v: &Ver) -> Option<bool> {
    let r = range.trim();
    if !(r.starts_with('[') || r.starts_with('(')) {
        // Einfache Angabe = „empfohlen“, gilt als Mindestversion
        let t = parse_ver(r)?;
        return Some(cmp_ver(v, &t) != Ordering::Less);
    }
    // Mehrere Bereiche: "[1,2),[3,)"
    let mut any = false;
    let mut decided = false;
    let mut rest = r;
    while let Some(start) = rest.find(['[', '(']) {
        let end = rest[start..].find([']', ')'])? + start;
        let part = &rest[start..=end];
        rest = &rest[end + 1..];
        let inclusive_lo = part.starts_with('[');
        let inclusive_hi = part.ends_with(']');
        let inner = &part[1..part.len() - 1];
        let (lo, hi) = match inner.split_once(',') {
            Some((a, b)) => (a.trim(), b.trim()),
            None => (inner.trim(), inner.trim()),
        };
        let mut ok = true;
        if !lo.is_empty() {
            let t = parse_ver(lo)?;
            let o = cmp_ver(v, &t);
            ok &= if inclusive_lo { o != Ordering::Less } else { o == Ordering::Greater };
        }
        if !hi.is_empty() {
            let t = parse_ver(hi)?;
            let o = cmp_ver(v, &t);
            ok &= if inclusive_hi { o != Ordering::Greater } else { o == Ordering::Less };
        }
        decided = true;
        any |= ok;
    }
    decided.then_some(any)
}

/// Erfüllt `version` den Bereich? `None` = nicht auswertbar.
pub fn satisfies(range: &str, version: &str) -> Option<bool> {
    let v = parse_ver(version)?;
    let r = range.trim();
    if r.is_empty() || r == "*" {
        return Some(true);
    }
    if r.starts_with('[') || r.starts_with('(') {
        return maven_range(r, &v);
    }
    let mut undecided = false;
    for alt in r.split("||") {
        let mut all = Some(true);
        for term in alt.split_whitespace() {
            match fabric_term(term, &v) {
                Some(true) => {}
                Some(false) => {
                    all = Some(false);
                    break;
                }
                None => all = None,
            }
        }
        match all {
            Some(true) => return Some(true),
            None => undecided = true,
            Some(false) => {}
        }
    }
    if undecided {
        None
    } else {
        Some(false)
    }
}

// ------------------------------------------------------------------ Check

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueKind {
    MissingDependency,
    /// Pflicht-Abhängigkeit ist installiert, aber deaktiviert
    DisabledDependency,
    VersionMismatch,
    Incompatible,
    Duplicate,
    WrongLoader,
    WrongMinecraft,
    /// Loader-Installation fehlt teilweise, ist beschädigt oder zuletzt fehlgeschlagen (kein Mod-Problem;
    /// `mod_name` = Loader-Name, `file_name` leer). Behebt „Probleme beheben“ (Loader neu installieren).
    LoaderFiles,
}

/// Ein-Klick-Lösung.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Fix {
    /// Abhängigkeit installieren (`content_install`)
    Install { source: Source, project_id: String, title: String },
    /// Dateien entfernen (`content_remove`, Art mod)
    Remove { file_names: Vec<String> },
    /// Mod deaktivieren (`content_set_enabled`)
    Disable { file_name: String },
    /// Deaktivierte Mod wieder aktivieren (`content_set_enabled`); `title` = Name der Mod
    Enable { file_name: String, title: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct DepIssue {
    pub kind: IssueKind,
    /// "error" (Spiel startet vermutlich nicht) | "warning"
    pub severity: String,
    /// Betroffene Mod-Datei
    pub file_name: String,
    pub mod_name: String,
    /// Betroffene Mod-ID (Abhängigkeit / Konfliktpartner)
    pub target: Option<String>,
    /// Datei des Gegenparts (installierte Abhängigkeit mit falscher Version, Konfliktpartner)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other_file: Option<String>,
    pub message: String,
    pub fixes: Vec<Fix>,
}

struct ModInfo<'a> {
    s: &'a Scanned,
    id: &'a str,
}

fn builtin_ids(inst: &Instance) -> Vec<&'static str> {
    let mut v = vec!["minecraft", "java"];
    match inst.loader.kind {
        LoaderKind::Fabric => v.extend(["fabricloader", "fabric-loader", "mixinextras"]),
        LoaderKind::Quilt => v.extend(["fabricloader", "fabric-loader", "quilt_loader", "quilt_base", "mixinextras"]),
        LoaderKind::Forge => v.extend(["forge", "javafml", "lowcodefml", "fml", "mixinextras"]),
        LoaderKind::Neoforge => v.extend(["neoforge", "forge", "javafml", "lowcodefml", "fml", "mixinextras"]),
        LoaderKind::Vanilla => {}
    }
    v
}

/// Sinytra Connector lädt Fabric-Mods unter NeoForge (und Forge 1.20.1).
fn connector_hosts(inst: &Instance) -> bool {
    inst.loader.kind == LoaderKind::Neoforge || (inst.loader.kind == LoaderKind::Forge && inst.mc_version == "1.20.1")
}

/// `connector`: Sinytra Connector ist aktiv installiert -> Fabric-Mods gelten als passend.
fn loader_ok(inst: &Instance, meta: &LocalMeta, connector: bool) -> bool {
    let Some(l) = meta.loader.as_deref() else { return true };
    match (inst.loader.kind, l) {
        (_, "multi") => true,
        (_, "fabric") if connector && connector_hosts(inst) => true,
        (LoaderKind::Fabric, "fabric") => true,
        (LoaderKind::Quilt, "fabric" | "quilt") => true,
        (LoaderKind::Forge, "forge") => true,
        (LoaderKind::Neoforge, "neoforge") => true,
        (LoaderKind::Neoforge, "forge") => inst.mc_version == "1.20.1",
        (LoaderKind::Vanilla, _) => false,
        _ => false,
    }
}

/// Abhängigkeits-ID eines Loaders, die für diese Instanz geprüft wird (`fabricloader` nur bei Fabric –
/// Quilt-Versionen sind nicht mit Fabric-Loader-Versionen vergleichbar).
fn loader_dep_applies(inst: &Instance, id: &str) -> bool {
    match id {
        "fabricloader" | "fabric-loader" => inst.loader.kind == LoaderKind::Fabric,
        "quilt_loader" => inst.loader.kind == LoaderKind::Quilt,
        "neoforge" => inst.loader.kind == LoaderKind::Neoforge,
        "forge" => inst.loader.kind == LoaderKind::Forge,
        _ => false,
    }
}

const LOADER_DEP_IDS: &[&str] = &["fabricloader", "fabric-loader", "quilt_loader", "neoforge", "forge"];

/// Versionsanforderung einer aktiven Mod an den Loader der Instanz.
#[derive(Debug, Clone, PartialEq)]
pub struct LoaderReq {
    pub file: String,
    pub mod_name: String,
    pub range: String,
}

/// Alle Loader-Versionsanforderungen der aktiven Mods (auch erfüllte – für die Wahl einer neuen Version).
pub fn loader_requirements(inst: &Instance, scanned: &[Scanned]) -> Vec<LoaderReq> {
    let mut out = vec![];
    for s in scanned.iter().filter(|s| s.enabled) {
        for d in s.meta.deps.iter().filter(|d| d.kind == "required" && loader_dep_applies(inst, &d.id)) {
            let Some(r) = d.range.as_deref().map(str::trim).filter(|r| !r.is_empty() && *r != "*") else { continue };
            out.push(LoaderReq { file: s.file_name.clone(), mod_name: name_of(s), range: r.to_string() });
        }
    }
    out
}

fn loader_label(l: &str) -> &str {
    match l {
        "fabric" => "Fabric",
        "quilt" => "Quilt",
        "forge" => "Forge",
        "neoforge" => "NeoForge",
        other => other,
    }
}

/// Bekannte Mod-ID -> Modrinth-Projekt (wo ID und Slug abweichen).
fn known_project(id: &str) -> Option<&'static str> {
    Some(match id {
        "fabric" | "fabric-api" | "fabric_api" => "P7dR8mSH",
        "fabric-language-kotlin" | "fabric_language_kotlin" => "Ha28R6CL",
        "yet_another_config_lib_v3" | "yet-another-config-lib" | "yacl" => "yacl",
        "cloth-config" | "cloth_config" | "cloth-config2" => "cloth-config",
        "forgeconfigapiport" => "forge-config-api-port",
        "puzzleslib" => "puzzles-lib",
        "owo" => "owo-lib",
        "geckolib" | "geckolib3" => "geckolib",
        "architectury" => "architectury-api",
        "kotlinforforge" => "kotlin-for-forge",
        "sodium" => "sodium",
        "iris" => "iris",
        _ => return None,
    })
}

/// Modrinth-Projekt zu einer Mod-ID suchen (bekannte Zuordnung, Slug, Suche).
pub(super) async fn resolve_modrinth(state: &AppState, id: &str, inst: &Instance) -> Option<(String, String)> {
    // Fabric-Mods über Connector: statt Fabric API die NeoForge-Portierung (Forgified Fabric API)
    let forgified = connector_hosts(inst) && matches!(id, "fabric" | "fabric-api" | "fabric_api");
    let candidate = if forgified {
        "forgified-fabric-api".to_string()
    } else {
        known_project(id).map(str::to_string).unwrap_or_else(|| id.replace('_', "-"))
    };
    if let Ok(p) = mr::raw_project(state, &candidate).await {
        if p.project_type == "mod" {
            return Some((p.id, p.title));
        }
    }
    // Suche nach der ID, Treffer muss zum normalisierten Slug passen
    let q = super::SearchQuery {
        source: Source::Modrinth,
        query: id.to_string(),
        project_type: super::ProjectType::Mod,
        game_version: Some(inst.mc_version.clone()),
        loader: Some(inst.loader.kind),
        categories: vec![],
        sort: super::SortOrder::Relevance,
        offset: 0,
        limit: 5,
        created_after: None,
    };
    let norm = |s: &str| s.to_ascii_lowercase().replace(['-', '_', ' '], "");
    let r = mr::search(state, &q).await.ok()?;
    r.hits.into_iter().find(|h| norm(&h.slug) == norm(id) || norm(&h.title) == norm(id)).map(|h| (h.id, h.title))
}

fn name_of(s: &Scanned) -> String {
    s.meta.name.clone().unwrap_or_else(|| s.file_name.clone())
}

/// Prüfung ohne Netz (für den Start); `resolve` ergänzt Installationsvorschläge über Modrinth.
pub async fn check(state: &AppState, instance_id: &str, resolve: bool) -> AppResult<Vec<DepIssue>> {
    let inst = state.instances.get(instance_id)?;
    let (scanned, _idx): (Vec<Scanned>, ContentIndex) = super::local::scan(state, instance_id, ContentKind::Mod).await?;
    fn info(s: &Scanned) -> Option<ModInfo<'_>> {
        s.meta.mod_id.as_deref().map(|id| ModInfo { s, id })
    }
    let mods: Vec<ModInfo> = scanned.iter().filter(|s| s.enabled).filter_map(info).collect();
    let disabled: Vec<ModInfo> = scanned.iter().filter(|s| !s.enabled).filter_map(info).collect();
    let mut issues = analyze(&inst, &mods, &disabled);
    if let Some(i) = loader_files_issue(&inst, &super::loaderfix::inspect(&state.paths, &inst)) {
        issues.push(i);
    }
    if resolve {
        // Fehlende Abhängigkeiten: Modrinth-Projekt suchen (gleiche ID nur einmal)
        let mut cache: HashMap<String, Option<(String, String)>> = HashMap::new();
        for i in issues.iter_mut().filter(|i| i.kind == IssueKind::MissingDependency) {
            let Some(t) = i.target.clone() else { continue };
            if !cache.contains_key(&t) {
                let r = resolve_modrinth(state, &t, &inst).await;
                cache.insert(t.clone(), r);
            }
            if let Some(Some((pid, title))) = cache.get(&t) {
                i.fixes.insert(0, Fix::Install { source: Source::Modrinth, project_id: pid.clone(), title: title.clone() });
            }
        }
    }
    Ok(issues)
}

/// Hinweis zur Loader-Installation (fehlende Dateien lädt der nächste Start nach -> nur Warnung).
pub(super) fn loader_files_issue(inst: &Instance, files: &super::loaderfix::LoaderFiles) -> Option<DepIssue> {
    use super::loaderfix::LoaderFiles as F;
    let name = loader_label(inst.loader.kind.as_str()).to_string();
    let full = match inst.loader.version.as_deref().filter(|v| !v.is_empty()) {
        Some(v) => format!("{name} {v}"),
        None => name.clone(),
    };
    let (severity, message) = match files {
        F::Ok | F::NotInstalled => return None,
        F::Failed => ("error", format!("{full}: Die letzte Installation ist fehlgeschlagen")),
        F::Missing { files } => ("warning", format!("{full}: {files} Datei(en) der Installation fehlen")),
        F::Broken { files } => ("error", format!("{full}: Die Installation ist beschädigt ({files} Datei(en))")),
    };
    Some(DepIssue {
        kind: IssueKind::LoaderFiles,
        severity: severity.into(),
        file_name: String::new(),
        mod_name: name,
        target: Some(inst.loader.kind.as_str().into()),
        other_file: None,
        message,
        fixes: vec![],
    })
}

/// `disabled`: deaktivierte Mods (`.disabled`) – nur, um bei fehlenden Abhängigkeiten „aktivieren“ anzubieten.
fn analyze(inst: &Instance, mods: &[ModInfo], disabled: &[ModInfo]) -> Vec<DepIssue> {
    let mut issues = Vec::new();
    let builtins = builtin_ids(inst);
    // ID -> deaktivierte Datei (eigene ID vor bereitgestellten IDs)
    let mut off: HashMap<&str, &Scanned> = HashMap::new();
    for m in disabled {
        off.insert(m.id, m.s);
    }
    for m in disabled {
        for p in &m.s.meta.provides {
            off.entry(p.as_str()).or_insert(m.s);
        }
    }
    // ID -> (Version, Datei) aller aktiven Mods inkl. bereitgestellter IDs
    let mut present: HashMap<&str, (Option<&str>, &Scanned)> = HashMap::new();
    let connector = mods.iter().any(|m| m.id == "connector");
    for m in mods {
        present.insert(m.id, (m.s.meta.version.as_deref(), m.s));
        // Eingebettete/bereitgestellte IDs: Version unbekannt (nicht die der Haupt-Mod)
        for p in &m.s.meta.provides {
            present.entry(p.as_str()).or_insert((None, m.s));
        }
    }
    for m in mods {
        let s = m.s;
        let name = name_of(s);
        if !loader_ok(inst, &s.meta, connector) {
            let l = s.meta.loader.as_deref().unwrap_or("?");
            issues.push(DepIssue {
                kind: IssueKind::WrongLoader,
                severity: "error".into(),
                file_name: s.file_name.clone(),
                mod_name: name.clone(),
                target: None,
                other_file: None,
                message: format!("{name} ist eine {}-Mod, die Instanz nutzt {}", loader_label(l), loader_label(inst.loader.kind.as_str())),
                fixes: vec![Fix::Disable { file_name: s.file_name.clone() }],
            });
            continue;
        }
        for d in &s.meta.deps {
            let id = d.id.as_str();
            match d.kind.as_str() {
                "required" => {
                    if id == "minecraft" {
                        if let Some(r) = &d.range {
                            if satisfies(r, &inst.mc_version) == Some(false) {
                                issues.push(DepIssue {
                                    kind: IssueKind::WrongMinecraft,
                                    severity: "error".into(),
                                    file_name: s.file_name.clone(),
                                    mod_name: name.clone(),
                                    target: Some("minecraft".into()),
                                    other_file: None,
                                    message: format!("{name} braucht Minecraft {r}, die Instanz nutzt {}", inst.mc_version),
                                    fixes: vec![Fix::Disable { file_name: s.file_name.clone() }],
                                });
                            }
                        }
                        continue;
                    }
                    if LOADER_DEP_IDS.contains(&id) {
                        if let (Some(r), Some(lv)) = (&d.range, inst.loader.version.as_deref()) {
                            if loader_dep_applies(inst, id) && satisfies(r, lv) == Some(false) {
                                issues.push(DepIssue {
                                    kind: IssueKind::VersionMismatch,
                                    severity: "error".into(),
                                    file_name: s.file_name.clone(),
                                    mod_name: name.clone(),
                                    target: Some(id.into()),
                                    other_file: None,
                                    message: format!("{name} braucht {} {r}, installiert ist {lv}", loader_label(inst.loader.kind.as_str())),
                                    fixes: vec![],
                                });
                            }
                        }
                        continue;
                    }
                    if builtins.contains(&id) {
                        continue;
                    }
                    // Mod-IDs mit „-“ und „_“ werden uneinheitlich angegeben (fabric-api / fabric_api)
                    let alias = if id.contains('-') { id.replace('-', "_") } else { id.replace('_', "-") };
                    let found = present.get(id).or_else(|| present.get(alias.as_str()));
                    match found {
                        None if off.contains_key(id) => {
                            let other = off[id];
                            issues.push(DepIssue {
                                kind: IssueKind::DisabledDependency,
                                severity: "error".into(),
                                file_name: s.file_name.clone(),
                                mod_name: name.clone(),
                                target: Some(id.into()),
                                other_file: None,
                                message: format!("{name} braucht {}, das deaktiviert ist", name_of(other)),
                                fixes: vec![Fix::Enable { file_name: other.file_name.clone(), title: name_of(other) }, Fix::Disable { file_name: s.file_name.clone() }],
                            });
                        }
                        None => issues.push(DepIssue {
                            kind: IssueKind::MissingDependency,
                            severity: "error".into(),
                            file_name: s.file_name.clone(),
                            mod_name: name.clone(),
                            target: Some(id.into()),
                            other_file: None,
                            message: format!("{name} braucht „{id}“{}", d.range.as_deref().filter(|r| *r != "*").map(|r| format!(" ({r})")).unwrap_or_default()),
                            fixes: vec![Fix::Disable { file_name: s.file_name.clone() }],
                        }),
                        Some((_, other)) if std::ptr::eq(*other, s) => {}
                        Some((ver, other)) => {
                            if let (Some(r), Some(v)) = (&d.range, ver) {
                                if satisfies(r, v) == Some(false) {
                                    issues.push(DepIssue {
                                        kind: IssueKind::VersionMismatch,
                                        severity: "warning".into(),
                                        file_name: s.file_name.clone(),
                                        mod_name: name.clone(),
                                        target: Some(id.into()),
                                        other_file: Some(other.file_name.clone()),
                                        message: format!("{name} braucht {} {r}, installiert ist {v}", name_of(other)),
                                        fixes: vec![],
                                    });
                                }
                            }
                        }
                    }
                }
                "breaks" => {
                    if let Some((ver, other)) = present.get(id) {
                        if std::ptr::eq(*other, s) {
                            continue;
                        }
                        let hit = match (&d.range, ver) {
                            (Some(r), Some(v)) => satisfies(r, v).unwrap_or(true),
                            _ => true,
                        };
                        if hit {
                            issues.push(DepIssue {
                                kind: IssueKind::Incompatible,
                                severity: "error".into(),
                                file_name: s.file_name.clone(),
                                mod_name: name.clone(),
                                target: Some(id.into()),
                                other_file: Some(other.file_name.clone()),
                                message: format!("{name} ist nicht mit {} kompatibel", name_of(other)),
                                fixes: vec![Fix::Disable { file_name: other.file_name.clone() }, Fix::Disable { file_name: s.file_name.clone() }],
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }
    // Doppelte Mods (gleiche ID in mehreren aktiven Dateien)
    let mut by_id: HashMap<&str, Vec<&Scanned>> = HashMap::new();
    for m in mods {
        by_id.entry(m.id).or_default().push(m.s);
    }
    let mut dups: Vec<(&str, Vec<&Scanned>)> = by_id.into_iter().filter(|(_, v)| v.len() > 1).collect();
    dups.sort_by_key(|(id, _)| *id);
    for (id, mut files) in dups {
        // neueste Version (sonst neueste Datei) behalten
        files.sort_by(|a, b| {
            let va = a.meta.version.as_deref().and_then(parse_ver);
            let vb = b.meta.version.as_deref().and_then(parse_ver);
            match (va, vb) {
                (Some(x), Some(y)) => cmp_ver(&y, &x),
                _ => b.modified.cmp(&a.modified),
            }
        });
        let keep = files[0];
        let remove: Vec<String> = files[1..].iter().map(|s| s.file_name.clone()).collect();
        issues.push(DepIssue {
            kind: IssueKind::Duplicate,
            severity: "error".into(),
            file_name: keep.file_name.clone(),
            mod_name: name_of(keep),
            target: Some(id.into()),
            other_file: None,
            message: format!("{} ist {}× installiert ({})", name_of(keep), files.len(), files.iter().map(|s| s.file_name.as_str()).collect::<Vec<_>>().join(", ")),
            fixes: vec![Fix::Remove { file_names: remove }],
        });
    }
    issues
}

/// Vor dem Start: Probleme ins Spiel-Log schreiben (Start wird nie verhindert).
pub async fn warn_before_launch(state: &AppState, instance_id: &str) {
    let Ok(issues) = check(state, instance_id, false).await else { return };
    let errors: Vec<&DepIssue> = issues.iter().filter(|i| i.severity == "error").collect();
    if errors.is_empty() {
        return;
    }
    let log = |m: String| state.game.launcher_line(instance_id, crate::minecraft::LogLevel::Launcher, m);
    log(format!("Warnung: Abhängigkeits-Check meldet {} Problem(e) – das Spiel startet evtl. nicht:", errors.len()));
    for i in errors.iter().take(20) {
        log(format!("  • {}", i.message));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::index::MetaDep;
    use crate::instance::Loader;

    #[test]
    fn ranges() {
        assert_eq!(satisfies(">=0.15.0", "0.16.9"), Some(true));
        assert_eq!(satisfies(">=0.17", "0.16.9"), Some(false));
        assert_eq!(satisfies("~1.20.1", "1.20.4"), Some(true));
        assert_eq!(satisfies("~1.20.1", "1.21"), Some(false));
        assert_eq!(satisfies("1.20.x", "1.20.6"), Some(true));
        assert_eq!(satisfies("1.20.x", "1.21.1"), Some(false));
        assert_eq!(satisfies(">=1.21 <1.22", "1.21.4"), Some(true));
        assert_eq!(satisfies(">=1.21 <1.22", "1.22"), Some(false));
        assert_eq!(satisfies("1.20.1 || 1.20.2", "1.20.2"), Some(true));
        assert_eq!(satisfies("^2.0", "3.1"), Some(false));
        assert_eq!(satisfies("*", "whatever"), None);
        assert_eq!(satisfies("[1.20.1,1.21)", "1.20.4"), Some(true));
        assert_eq!(satisfies("[1.20.1,1.21)", "1.21"), Some(false));
        assert_eq!(satisfies("[47,)", "47.2.0"), Some(true));
        assert_eq!(satisfies("[1.21.1]", "1.21.1"), Some(true));
        assert_eq!(satisfies("[1.0,2.0),[3.0,)", "3.5"), Some(true));
        assert_eq!(satisfies(">=0.5.0", "0.5.3+mc1.20.1"), Some(true));
        assert_eq!(satisfies(">=1.0.0", "1.0.0-beta.1"), Some(false));
    }

    fn scanned(file: &str, id: &str, version: &str, loader: &str, deps: Vec<MetaDep>) -> Scanned {
        Scanned {
            file_name: file.into(),
            key: format!("mods/{file}"),
            enabled: true,
            path: file.into(),
            meta: LocalMeta { mod_id: Some(id.into()), version: Some(version.into()), loader: Some(loader.into()), deps, ..Default::default() },
            modified: 0,
            size: 1,
        }
    }

    fn d(id: &str, range: Option<&str>, kind: &str) -> MetaDep {
        MetaDep { id: id.into(), range: range.map(str::to_string), kind: kind.into() }
    }

    #[test]
    fn analyze_issues() {
        let inst: Instance = serde_json::from_value(serde_json::json!({
            "id": "x", "name": "x", "icon": null, "accent": null, "group": null, "mc_version": "1.20.1",
            "loader": Loader { kind: LoaderKind::Fabric, version: Some("0.16.9".into()) }, "created_at": 0
        }))
        .unwrap();
        let a = scanned("a.jar", "moda", "1.0", "fabric", vec![d("fabric-api", Some("*"), "required"), d("minecraft", Some("~1.20"), "required"), d("modb", None, "breaks")]);
        let b = scanned("b.jar", "modb", "2.0", "fabric", vec![d("minecraft", Some(">=1.21"), "required"), d("fabricloader", Some(">=0.17"), "required")]);
        let c1 = scanned("c-1.jar", "modc", "1.0.0", "fabric", vec![]);
        let c2 = scanned("c-2.jar", "modc", "1.2.0", "fabric", vec![]);
        let f = scanned("f.jar", "forgemod", "1", "forge", vec![]);
        let all = [&a, &b, &c1, &c2, &f];
        let mods: Vec<ModInfo> = all.iter().map(|s| ModInfo { s, id: s.meta.mod_id.as_deref().unwrap() }).collect();
        let issues = analyze(&inst, &mods, &[]);
        let kinds: Vec<IssueKind> = issues.iter().map(|i| i.kind).collect();
        assert!(kinds.contains(&IssueKind::MissingDependency), "{issues:#?}");
        assert!(kinds.contains(&IssueKind::Incompatible));
        assert!(kinds.contains(&IssueKind::WrongMinecraft));
        assert!(kinds.contains(&IssueKind::VersionMismatch), "fabricloader zu alt");
        assert!(kinds.contains(&IssueKind::WrongLoader));
        let dup = issues.iter().find(|i| i.kind == IssueKind::Duplicate).unwrap();
        assert_eq!(dup.file_name, "c-2.jar", "neuere Version bleibt");
        assert!(matches!(&dup.fixes[0], Fix::Remove { file_names } if file_names == &vec!["c-1.jar".to_string()]));
        // ~1.20 erlaubt 1.20.1 -> kein Minecraft-Problem für a
        assert!(!issues.iter().any(|i| i.kind == IssueKind::WrongMinecraft && i.file_name == "a.jar"));
    }

    #[test]
    fn disabled_dependency() {
        let inst: Instance = serde_json::from_value(serde_json::json!({
            "id": "x", "name": "x", "icon": null, "accent": null, "group": null, "mc_version": "1.21.1",
            "loader": Loader { kind: LoaderKind::Fabric, version: Some("0.16.9".into()) }, "created_at": 0
        }))
        .unwrap();
        let a = scanned("vibey.jar", "vibey", "1.0", "fabric", vec![d("fabric-api", Some("*"), "required"), d("cloth-config", None, "required")]);
        let mut api = scanned("fabric-api-0.110.jar.disabled", "fabric-api", "0.110.0", "fabric", vec![]);
        api.enabled = false;
        api.meta.name = Some("Fabric API".into());
        let mods = [ModInfo { s: &a, id: "vibey" }];
        let off = [ModInfo { s: &api, id: "fabric-api" }];
        let issues = analyze(&inst, &mods, &off);
        let dis = issues.iter().find(|i| i.target.as_deref() == Some("fabric-api")).unwrap();
        assert_eq!(dis.kind, IssueKind::DisabledDependency);
        assert!(matches!(&dis.fixes[0], Fix::Enable { file_name, title } if file_name == "fabric-api-0.110.jar.disabled" && title == "Fabric API"));
        // Wirklich fehlende Abhängigkeit bleibt „fehlt“
        let miss = issues.iter().find(|i| i.target.as_deref() == Some("cloth-config")).unwrap();
        assert_eq!(miss.kind, IssueKind::MissingDependency);
        // Bereitgestellte ID einer deaktivierten Mod zählt auch
        let mut bundle = scanned("bundle.jar.disabled", "bundle", "1", "fabric", vec![]);
        bundle.enabled = false;
        bundle.meta.provides = vec!["cloth-config".into()];
        let off = [ModInfo { s: &api, id: "fabric-api" }, ModInfo { s: &bundle, id: "bundle" }];
        let issues = analyze(&inst, &mods, &off);
        assert!(issues.iter().all(|i| i.kind == IssueKind::DisabledDependency), "{issues:#?}");
    }
}
