//! Vibey Client pro Instanz: Jar in `mods/` legen, Abhängigkeiten mitinstallieren, vor dem Start still
//! aktualisieren, beim Ausschalten entfernen.
//!
//! Das Jar ist eine vom Launcher **verwaltete** Datei: Zustand in `instances/<id>/vibey-client.json`
//! (Version, Dateiname, SHA-256). Deaktiviert der Nutzer die Mod in der Inhalte-Liste (`.disabled`),
//! bleibt sie auch nach Updates deaktiviert.
use super::{ClientFile, ClientRelease};
use crate::content::index::ContentIndex;
use crate::content::{install as cinstall, local, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{CreateInstance, Instance, Loader, LoaderKind};
use crate::minecraft::LogLevel;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Zustand je Instanz (`vibey-client.json`).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct InstanceState {
    pub enabled: bool,
    pub version: Option<String>,
    pub channel: Option<String>,
    /// Dateiname in `mods/` (ohne `.disabled`)
    pub file: Option<String>,
    pub sha256: Option<String>,
    /// Für welche Instanz-Version installiert (Wechsel der MC-Version/des Loaders erkennen)
    pub mc_version: Option<String>,
    pub loader: Option<String>,
    pub installed_at: Option<i64>,
    /// Vom Launcher mitinstallierte Abhängigkeiten (Modrinth-IDs)
    pub requires: Vec<String>,
}

fn state_path(state: &AppState, id: &str) -> PathBuf {
    state.paths.instance_dir(id).join("vibey-client.json")
}

pub fn load(state: &AppState, id: &str) -> InstanceState {
    std::fs::read(state_path(state, id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(state: &AppState, id: &str, s: &InstanceState) -> AppResult<()> {
    if !state.paths.instance_dir(id).exists() {
        return Ok(());
    }
    crate::util::write_json_atomic(&state_path(state, id), s)
}

/// Loader-Name im Manifest (nur Fabric und NeoForge werden unterstützt).
pub fn loader_name(kind: LoaderKind) -> Option<&'static str> {
    match kind {
        LoaderKind::Fabric => Some("fabric"),
        LoaderKind::Neoforge => Some("neoforge"),
        _ => None,
    }
}

fn mods_dir(state: &AppState, id: &str) -> PathBuf {
    state.paths.game_dir(id).join("mods")
}

/// Pfad der verwalteten Datei, falls vorhanden: (Pfad, aktiv?)
fn managed_file(state: &AppState, id: &str, s: &InstanceState) -> Option<(PathBuf, bool)> {
    let f = s.file.as_ref()?;
    let p = mods_dir(state, id).join(f);
    if p.is_file() {
        return Some((p, true));
    }
    let d = mods_dir(state, id).join(format!("{f}.disabled"));
    d.is_file().then_some((d, false))
}

/// Status für die Oberfläche.
#[derive(Debug, Clone, Serialize)]
pub struct ClientStatus {
    pub enabled: bool,
    pub installed_version: Option<String>,
    pub file: Option<String>,
    /// Datei liegt in `mods/`
    pub present: bool,
    /// in der Inhalte-Liste deaktiviert (`.disabled`)
    pub disabled_by_user: bool,
    /// Loader der Instanz wird unterstützt (Fabric/NeoForge)
    pub loader_supported: bool,
    /// Passt ein Jar zur Instanz? `None` = unbekannt (offline / Dienste aus)
    pub supported: Option<bool>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    /// Unterstützte MC-Versionen für den Loader der Instanz
    pub mc_versions: Vec<String>,
    pub channel: String,
    pub vibe_enabled: bool,
    /// Fehler beim Abfragen des Manifests
    pub error: Option<String>,
    pub requires: Vec<String>,
}

pub async fn status(state: &AppState, id: &str) -> AppResult<ClientStatus> {
    let inst = state.instances.get(id)?;
    let s = load(state, id);
    let file = managed_file(state, id, &s);
    let loader = loader_name(inst.loader.kind);
    let vibe_enabled = state.settings().vibe.enabled;
    let mut out = ClientStatus {
        enabled: s.enabled,
        installed_version: file.as_ref().and(s.version.clone()),
        file: s.file.clone(),
        present: file.is_some(),
        disabled_by_user: file.as_ref().is_some_and(|(_, on)| !on),
        loader_supported: loader.is_some(),
        supported: if loader.is_none() { Some(false) } else { None },
        latest_version: None,
        update_available: false,
        mc_versions: vec![],
        channel: super::channel(state).to_string(),
        vibe_enabled,
        error: None,
        requires: s.requires.clone(),
    };
    if let (Some(l), true) = (loader, vibe_enabled) {
        match super::latest(state, false).await {
            Ok(rel) => {
                let f = rel.file_for(l, &inst.mc_version);
                out.supported = Some(f.is_some());
                out.mc_versions = rel.mc_versions(l);
                out.latest_version = Some(rel.version.clone());
                out.update_available = out.present && f.is_some_and(|f| Some(&f.sha256) != s.sha256.as_ref());
            }
            Err(e) => out.error = Some(e.to_string()),
        }
    }
    Ok(out)
}

/// Pflicht-Abhängigkeiten, die als Mod-ID erkannt werden können (falls die Datei nicht zugeordnet ist).
fn known_mod_id(modrinth: &str) -> Option<&'static str> {
    match modrinth {
        "P7dR8mSH" => Some("fabric-api"),
        "Ha28R6CL" => Some("fabric-language-kotlin"),
        _ => None,
    }
}

/// Fehlende Pflicht-Abhängigkeiten über Modrinth installieren. Gibt die installierten IDs zurück.
async fn ensure_requires(state: &AppState, inst: &Instance, file: &ClientFile, log: &(dyn Fn(String) + Sync), task: &TaskHandle) -> AppResult<Vec<String>> {
    let wanted: Vec<&str> = file.requires.iter().filter_map(|r| r.modrinth.as_deref()).filter(|s| !s.is_empty()).collect();
    if wanted.is_empty() {
        return Ok(vec![]);
    }
    let (scanned, idx) = local::refresh(state, &inst.id, ContentKind::Mod).await?;
    let missing: Vec<String> = wanted
        .into_iter()
        .filter(|pid| {
            if idx.has_project(Source::Modrinth, pid) {
                return false;
            }
            let mid = known_mod_id(pid);
            !scanned.iter().any(|s| mid.is_some_and(|m| s.meta.mod_id.as_deref() == Some(m) || s.meta.provides.iter().any(|p| p == m)))
        })
        .map(str::to_string)
        .collect();
    if missing.is_empty() {
        return Ok(vec![]);
    }
    let names: Vec<String> = file.requires.iter().filter(|r| r.modrinth.as_ref().is_some_and(|m| missing.contains(m))).map(|r| r.name.clone().unwrap_or_else(|| r.modrinth.clone().unwrap_or_default())).collect();
    task.stage(format!("Installiere {} …", names.join(", ")), None);
    let idx = ContentIndex::load(&state.paths, &inst.id);
    let mut warnings = Vec::new();
    let roots = missing.iter().map(|p| (Source::Modrinth, p.clone(), None)).collect();
    let planned = cinstall::plan(state, inst, &idx, roots, &mut warnings).await?;
    cinstall::apply(state, inst, planned, &task.sub(0.6, 0.95)).await?;
    for w in warnings {
        log(format!("Vibey Client: {w}"));
    }
    log(format!("Vibey Client: Abhängigkeiten installiert: {}", names.join(", ")));
    Ok(missing)
}

/// Passendes Jar installieren bzw. aktualisieren. `true`, wenn sich etwas geändert hat.
pub async fn sync(state: &AppState, id: &str, rel: &ClientRelease, task: &TaskHandle, log: &(dyn Fn(String) + Sync)) -> AppResult<bool> {
    let inst = state.instances.get(id)?;
    let loader = loader_name(inst.loader.kind).ok_or_else(|| AppError::Invalid("Der Vibey Client läuft nur mit Fabric oder NeoForge.".into()))?;
    let mut s = load(state, id);
    let current = managed_file(state, id, &s);
    let Some(file) = rel.file_for(loader, &inst.mc_version) else {
        // Instanz passt (nicht mehr): verwaltetes Jar entfernen, damit das Spiel nicht abstürzt
        if let Some((p, _)) = &current {
            let _ = tokio::fs::remove_file(p).await;
            s.file = None;
            s.version = None;
            s.sha256 = None;
            save(state, id, &s)?;
            state.content.emit_changed(id);
            log(format!("Vibey Client: entfernt – Minecraft {} mit {loader} wird nicht unterstützt", inst.mc_version));
        }
        return Err(AppError::NotFound(format!("Vibey Client {} unterstützt Minecraft {} mit {} nicht.", rel.version, inst.mc_version, loader_pretty(loader))));
    };
    let name = super::safe_file_name(&file.file, ".jar")?;
    let base = crate::vibe::ensure(state, crate::vibe::Feature::Any)?;
    let url = super::resolve_url(&base, &file.url)?;
    let up_to_date = current.is_some() && s.sha256.as_deref() == Some(file.sha256.as_str()) && s.file.as_deref() == Some(name.as_str());
    let mut changed = false;
    if !up_to_date {
        task.stage(format!("Vibey Client {} wird geladen …", rel.version), Some(0.1));
        let was_disabled = current.as_ref().is_some_and(|(_, on)| !on);
        let target = mods_dir(state, id).join(if was_disabled { format!("{name}.disabled") } else { name.clone() });
        let tmp = state.paths.tmp().join(format!("vibey-{}-{name}", chrono::Utc::now().timestamp_millis()));
        super::download_verified(state, &url, &tmp, &file.sha256, Some(file.size)).await?;
        tokio::fs::create_dir_all(mods_dir(state, id)).await?;
        if let Some((old, _)) = &current {
            if old != &target {
                let _ = tokio::fs::remove_file(old).await;
            }
        }
        move_file(&tmp, &target).await?;
        let old_version = s.version.clone();
        s.file = Some(name.clone());
        s.version = Some(rel.version.clone());
        s.sha256 = Some(file.sha256.clone());
        s.channel = Some(rel.channel.clone());
        s.mc_version = Some(inst.mc_version.clone());
        s.loader = Some(loader.to_string());
        s.installed_at = Some(chrono::Utc::now().timestamp_millis());
        save(state, id, &s)?;
        changed = true;
        match old_version {
            Some(v) if current.is_some() && v != rel.version => log(format!("Vibey Client aktualisiert: {v} → {}", rel.version)),
            _ => log(format!("Vibey Client {} installiert ({name})", rel.version)),
        }
    }
    task.check()?;
    let installed = ensure_requires(state, &inst, file, log, task).await?;
    if !installed.is_empty() {
        for i in installed {
            if !s.requires.contains(&i) {
                s.requires.push(i);
            }
        }
        save(state, id, &s)?;
        changed = true;
    }
    if changed {
        state.content.emit_changed(id);
    }
    Ok(changed)
}

fn loader_pretty(l: &str) -> &'static str {
    if l == "neoforge" {
        "NeoForge"
    } else {
        "Fabric"
    }
}

async fn move_file(from: &Path, to: &Path) -> AppResult<()> {
    if tokio::fs::rename(from, to).await.is_err() {
        tokio::fs::copy(from, to).await?;
        let _ = tokio::fs::remove_file(from).await;
    }
    Ok(())
}

/// Schalter an: Zustand merken und installieren (Task-Körper).
pub async fn enable(state: AppState, task: TaskHandle, id: String) -> AppResult<()> {
    let inst = state.instances.get(&id)?;
    if loader_name(inst.loader.kind).is_none() {
        return Err(AppError::Invalid("Der Vibey Client läuft nur mit Fabric oder NeoForge.".into()));
    }
    if state.game.is_running(&id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst beenden.".into()));
    }
    task.stage("Suche den neuesten Vibey Client …", Some(0.02));
    let rel = super::latest(&state, true).await?;
    let mut s = load(&state, &id);
    s.enabled = true;
    save(&state, &id, &s)?;
    let log = |m: String| state.game.launcher_line(&id, LogLevel::Launcher, m);
    sync(&state, &id, &rel, &task, &log).await?;
    task.message(format!("Vibey Client {} ist installiert", rel.version));
    Ok(())
}

/// Schalter aus: verwaltetes Jar entfernen (Abhängigkeiten bleiben – andere Mods brauchen sie evtl.).
pub async fn disable(state: &AppState, id: &str) -> AppResult<()> {
    state.instances.get(id)?;
    if state.game.is_running(id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst beenden.".into()));
    }
    let mut s = load(state, id);
    if let Some((p, _)) = managed_file(state, id, &s) {
        tokio::fs::remove_file(&p).await?;
    }
    s.enabled = false;
    s.file = None;
    s.version = None;
    s.sha256 = None;
    save(state, id, &s)?;
    state.content.emit_changed(id);
    Ok(())
}

/// Hook vor dem Spielstart: bei aktivem Schalter still aktualisieren. Schlägt nie fehl.
pub async fn before_launch(state: &AppState, id: &str, task: &TaskHandle) {
    let s = load(state, id);
    if !s.enabled {
        return;
    }
    let log = |m: String| state.game.launcher_line(id, LogLevel::Launcher, m);
    if !state.settings().vibe.enabled {
        log("Vibey Client: Update-Prüfung übersprungen (Vibe-Dienste aus)".into());
        return;
    }
    task.stage("Vibey Client wird geprüft …", None);
    let run = async {
        let rel = super::latest(state, true).await?;
        sync(state, id, &rel, task, &log).await
    };
    match tokio::time::timeout(Duration::from_secs(90), run).await {
        Ok(Ok(false)) => log(format!("Vibey Client: aktuell ({})", s.version.unwrap_or_default())),
        Ok(Ok(true)) => {}
        Ok(Err(AppError::Cancelled)) => {}
        Ok(Err(e)) => log(format!("Vibey Client: Update übersprungen: {e}")),
        Err(_) => log("Vibey Client: Update übersprungen (Zeitlimit)".into()),
    }
}

/// Neueste vom Vibey Client unterstützte Release-Version (Reihenfolge des Mojang-Manifests).
pub async fn newest_supported(state: &AppState, rel: &ClientRelease, loader: &str) -> Option<String> {
    let list = rel.mc_versions(loader);
    if list.is_empty() {
        return None;
    }
    if let Ok(m) = crate::minecraft::meta::manifest(state, false).await {
        if let Some(e) = m.versions.iter().find(|e| list.contains(&e.id)) {
            return Some(e.id.clone());
        }
    }
    list.into_iter().max_by(|a, b| cmp_versions(a, b))
}

/// Grober Versionsvergleich (1.21.10 > 1.21.9 > 1.21; 26.1 > 1.21.11).
pub fn cmp_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |s: &str| s.split(['.', '-']).map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parse(a).cmp(&parse(b))
}

/// „Vibey-Client-Instanz erstellen“: neue Fabric-Instanz in der neuesten unterstützten Version (Task-Körper).
pub async fn create_instance(state: AppState, task: TaskHandle) -> AppResult<()> {
    task.stage("Suche den neuesten Vibey Client …", Some(0.02));
    let rel = super::latest(&state, true).await?;
    let mc = newest_supported(&state, &rel, "fabric").await.ok_or_else(|| AppError::NotFound("Der Vibey Client hat noch kein Fabric-Jar.".into()))?;
    let inst = state.instances.create(CreateInstance {
        name: "Vibey Client".into(),
        mc_version: mc.clone(),
        loader: Loader { kind: LoaderKind::Fabric, version: None },
        icon: None,
        accent: Some("#8b6cff".into()),
        group: None,
    })?;
    task.set_instance(inst.id.clone());
    let mut s = load(&state, &inst.id);
    s.enabled = true;
    save(&state, &inst.id, &s)?;
    let log = |m: String| state.game.launcher_line(&inst.id, LogLevel::Launcher, m);
    sync(&state, &inst.id, &rel, &task, &log).await?;
    task.message(format!("Instanz „{}“ mit Vibey Client {} (Minecraft {mc}) erstellt", inst.name, rel.version));
    Ok(())
}

/// Instanzen mit aktivem Vibey Client (für den Creator-Bereich: Spielordner für den Live-Link).
#[derive(Debug, Clone, Serialize)]
pub struct VibeyInstance {
    pub instance_id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: String,
    pub version: Option<String>,
    pub game_dir: String,
    /// `vibeyclient/devlink.json` existiert (Creator-Modus war an)
    pub devlink: bool,
}

pub fn vibey_instances(state: &AppState) -> Vec<VibeyInstance> {
    state
        .instances
        .list()
        .into_iter()
        .filter_map(|i| {
            let s = load(state, &i.id);
            if !s.enabled {
                return None;
            }
            let game = state.paths.game_dir(&i.id);
            Some(VibeyInstance {
                instance_id: i.id.clone(),
                name: i.name.clone(),
                mc_version: i.mc_version.clone(),
                loader: loader_name(i.loader.kind).unwrap_or("?").to_string(),
                version: s.version.clone(),
                devlink: game.join("vibeyclient").join("devlink.json").is_file(),
                game_dir: game.to_string_lossy().to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn versions() {
        assert_eq!(cmp_versions("1.21.10", "1.21.9"), Ordering::Greater);
        assert_eq!(cmp_versions("1.21", "1.21.1"), Ordering::Less);
        assert_eq!(cmp_versions("26.1", "1.21.11"), Ordering::Greater);
        assert_eq!(cmp_versions("26.3", "26.3"), Ordering::Equal);
    }

    #[test]
    fn loaders() {
        assert_eq!(loader_name(LoaderKind::Fabric), Some("fabric"));
        assert_eq!(loader_name(LoaderKind::Neoforge), Some("neoforge"));
        assert_eq!(loader_name(LoaderKind::Forge), None);
        assert_eq!(loader_name(LoaderKind::Vanilla), None);
    }

    #[test]
    fn state_roundtrip() {
        let s = InstanceState { enabled: true, version: Some("0.2.0".into()), requires: vec!["P7dR8mSH".into()], ..Default::default() };
        let j = serde_json::to_string(&s).unwrap();
        assert_eq!(serde_json::from_str::<InstanceState>(&j).unwrap(), s);
        // Unbekannte/fehlende Felder sind ok
        let s2: InstanceState = serde_json::from_str(r#"{"enabled":true,"neu":1}"#).unwrap();
        assert!(s2.enabled && s2.file.is_none());
    }
}
