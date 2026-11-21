use super::*;

// ------------------------------------------------------------------ Prüfung ohne Instanz (Neue Instanz)

#[derive(Debug, Clone, Serialize)]
pub struct CheckMissing {
    pub title: String,
    pub icon_url: Option<String>,
    pub reason: Reason,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetCheck {
    pub total: u32,
    pub available: u32,
    pub missing: Vec<CheckMissing>,
}

/// Wie viele Projekte der Sets gibt es für Version + Loader? (ohne Abhängigkeiten)
pub async fn check(state: &AppState, set_ids: &[String], mc: &str, loader: LoaderKind) -> AppResult<SetCheck> {
    let all = sets::all(&state.paths);
    let entries = merged_entries(set_ids, None, &all)?;
    let total = entries.len() as u32;
    let futs: Vec<_> = entries
        .into_iter()
        .map(|(e, _)| async move {
            let (r, _, _) = resolve(state, &e, mc, loader).await;
            (e, r)
        })
        .collect();
    let results: Vec<(SetEntry, Resolution)> = futures::stream::iter(futs).buffered(6).collect().await;
    let mut missing = Vec::new();
    for (e, r) in results {
        if let Resolution::Unavailable { reason, .. } = r {
            missing.push(CheckMissing { title: e.title, icon_url: e.icon_url, reason });
        }
    }
    Ok(SetCheck { total, available: total - missing.len() as u32, missing })
}
