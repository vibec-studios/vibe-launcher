use super::*;

// ------------------------------------------------------------------ Installation

/// Ausgewähltes Projekt (Eintrag oder Alternative), optional mit fester Version.
#[derive(Debug, Clone, Deserialize)]
pub struct Pick {
    pub source: Source,
    pub project_id: String,
    #[serde(default)]
    pub version_id: Option<String>,
}

pub(super) fn set_names(state: &AppState, set_ids: &[String]) -> String {
    let all = sets::all(&state.paths);
    let names: Vec<String> = set_ids.iter().filter_map(|id| all.iter().find(|s| &s.id == id).map(|s| format!("„{}“", s.name))).collect();
    names.join(", ")
}

/// Task-Körper: Sets anwenden. `picks = None`: alles Verfügbare ohne Konflikte (neue Instanz, „Mit Sets starten“).
/// `snapshot`: vorher Sicherung (bei bestehenden Instanzen).
pub async fn run_apply(state: AppState, task: TaskHandle, instance_id: String, set_ids: Vec<String>, picks: Option<Vec<Pick>>, snapshot: bool) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    let names = set_names(&state, &set_ids);
    task.set_title(format!("Mod-Set {names} anwenden"));
    let mut skipped = 0usize;
    let picks = match picks {
        Some(p) => p,
        None => {
            task.stage("Suche passende Versionen …", None);
            let pv = preview(&state, &instance_id, &set_ids, None).await?;
            skipped = pv.items.iter().filter(|i| matches!(i.status, ItemStatus::Unavailable | ItemStatus::Conflict)).count();
            pv.items
                .into_iter()
                .filter(|i| i.selected)
                .map(|i| Pick { source: i.entry.source, project_id: i.entry.project_id, version_id: i.version_id })
                .collect()
        }
    };
    task.check()?;
    if picks.is_empty() {
        record_applied(&state, &instance_id, &set_ids)?;
        task.message(if skipped > 0 { format!("Nichts installiert – {skipped} Inhalt(e) passen nicht zu dieser Instanz") } else { "Alles war schon installiert".into() });
        return Ok(());
    }
    if snapshot {
        task.stage("Sicherung wird erstellt …", None);
        if let Err(e) = crate::content::snapshots::create(&state, &instance_id, &format!("Vor Mod-Set {names}"), true, None).await {
            tracing::warn!("Snapshot vor Mod-Set fehlgeschlagen: {e}");
        }
        task.check()?;
    }
    task.stage("Löse Abhängigkeiten auf …", Some(0.05));
    let (_, idx) = install::refresh_all(&state, &instance_id).await?;
    let mut plans: Vec<Vec<Planned>> = Vec::new();
    let mut warnings = Vec::new();
    let mut failed = Vec::new();
    // Je Projekt einzeln planen: ein nicht installierbares Projekt bricht die übrigen nicht ab
    for p in picks {
        task.check()?;
        match install::plan(&state, &inst, &idx, vec![(p.source, p.project_id.clone(), p.version_id.clone())], &mut warnings).await {
            Ok(list) => plans.push(list),
            Err(e) => failed.push(format!("{}: {e}", p.project_id)),
        }
    }
    let planned = merge_plans(plans);
    for w in &warnings {
        tracing::warn!("Mod-Set {instance_id}: {w}");
    }
    let n = planned.iter().filter(|p| p.file.url.is_some()).count();
    task.stage(format!("Lade {n} Datei(en) …"), Some(0.15));
    let missing = install::apply(&state, &inst, planned, &task.sub(0.15, 1.0)).await?;
    if !missing.is_empty() {
        crate::content::missing::watch(&state, &instance_id, crate::content::missing::WATCH_FOR);
    }
    record_applied(&state, &instance_id, &set_ids)?;
    let mut msg = format!("{n} Datei(en) installiert");
    if !missing.is_empty() {
        msg.push_str(&format!(", {} manuell herunterzuladen", missing.len()));
    }
    if skipped + failed.len() > 0 {
        msg.push_str(&format!(", {} übersprungen", skipped + failed.len()));
    }
    if let Some(f) = failed.first() {
        tracing::warn!("Mod-Set {instance_id}: {f}");
    }
    task.message(msg);
    Ok(())
}
