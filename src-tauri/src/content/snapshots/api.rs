use super::*;

// ------------------------------------------------------------------ Öffentliche API

/// Eine Snapshot-Operation zur Zeit (Objektspeicher + Aufräumen).
pub(super) static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[allow(clippy::too_many_arguments)]
pub(super) async fn create_locked(state: &AppState, instance_id: &str, name: &str, auto: bool, sel: Sel, prog: Progress, protect: Vec<String>, version: Option<GameVersion>) -> AppResult<SnapshotInfo> {
    let paths = state.paths.clone();
    let keep = state.settings().snapshot_keep;
    let (id, name) = (instance_id.to_string(), name.to_string());
    tokio::task::spawn_blocking(move || {
        let root = backups_root(&paths);
        let migration = version.map(|version| MigrationState { version, pending_mods: missing::pending_mods(&paths, &id) });
        let res = create_with_version(&root, &id, &paths.game_dir(&id), &paths.instance_dir(&id), &name, auto, &sel, &prog, migration);
        let m = match res {
            Ok(m) => m,
            Err(e) => {
                // Halb abgelegte Objekte wieder entfernen
                let _ = gc(&root);
                return Err(e);
            }
        };
        if auto {
            let mut protect: Vec<&str> = protect.iter().map(String::as_str).collect();
            protect.push(&m.id);
            if let Err(e) = prune_auto(&root, &id, keep, &protect) {
                tracing::warn!("Alte Snapshots von {id} nicht aufgeräumt: {e}");
            }
        }
        Ok(m.info())
    })
    .await?
}

/// Snapshot anlegen. `auto` = automatisch (zählt zur Aufbewahrungsgrenze `Settings.snapshot_keep`).
pub async fn create(state: &AppState, instance_id: &str, name: &str, auto: bool, progress: Option<&crate::tasks::SubProgress>) -> AppResult<SnapshotInfo> {
    state.instances.get(instance_id)?;
    let _g = LOCK.lock().await;
    create_locked(state, instance_id, name, auto, Sel::all(), Progress::from(progress), vec![], None).await
}

/// Teil-Snapshot mit den gewählten Bereichen ([`SCOPES`]; alle = vollständig).
pub async fn create_scoped(state: &AppState, instance_id: &str, name: &str, auto: bool, scopes: &[String], progress: Option<&crate::tasks::SubProgress>) -> AppResult<SnapshotInfo> {
    state.instances.get(instance_id)?;
    let sel = Sel::of(scopes);
    if sel.scopes().is_some_and(|v| v.is_empty()) {
        return Err(AppError::Invalid("Kein Bereich für die Sicherung gewählt".into()));
    }
    let _g = LOCK.lock().await;
    create_locked(state, instance_id, name, auto, sel, Progress::from(progress), vec![], None).await
}

pub(crate) async fn before_migration(state: &AppState, instance_id: &str, version: GameVersion, progress: &SubProgress) -> AppResult<()> {
    let _guard = LOCK.lock().await;
    let scope = Sel::of(&["mods".into()]);
    let label = migration::text(state, "Vor Versionswechsel", "Before version change");
    let name = format!("{label} ({} {})", version.mc_version, version.loader.kind.as_str());
    create_locked(state, instance_id, &name, true, scope, Progress::from(Some(progress)), vec![], Some(version)).await?;
    Ok(())
}

/// Sicherung vor automatischen Mod-Änderungen („Probleme beheben“, Performance-Mods) nach der Einstellung
/// `Settings.fix_backup`. `None` = keine Sicherung gewünscht.
pub fn fix_backup_scopes(b: &crate::settings::FixBackup) -> Option<Vec<String>> {
    let v: Vec<String> = match b.mode.as_str() {
        "none" => return None,
        "mods" => vec!["mods".into()],
        "all" => SCOPES.iter().map(|s| s.to_string()).collect(),
        "custom" => SCOPES.iter().filter(|s| b.areas.iter().any(|a| a == *s)).map(|s| s.to_string()).collect(),
        _ => crate::settings::FixBackup::RECOMMENDED.iter().map(|s| s.to_string()).collect(),
    };
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

/// Snapshot wiederherstellen: legt vorher automatisch „Vor Wiederherstellung“ an, bringt die
/// enthaltenen Ordner/Dateien exakt auf den Stand des Snapshots und sendet `content://changed`.
pub async fn restore(state: &AppState, instance_id: &str, snapshot_id: &str, progress: Option<&crate::tasks::SubProgress>) -> AppResult<()> {
    state.instances.get(instance_id)?;
    check_id(snapshot_id, "Snapshot-ID")?;
    if state.game.is_running(instance_id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst das Spiel beenden.".into()));
    }
    // Reihenfolge: erst content.json-Sperre, dann Snapshot-Sperre
    let content_lock = state.content.lock(instance_id);
    let _c = content_lock.lock().await;
    migration::guard(state, instance_id)?;
    let inst = state.instances.get(instance_id)?;
    let _g = LOCK.lock().await;
    let root = backups_root(&state.paths);
    let (r2, iid, sid) = (root.clone(), instance_id.to_string(), snapshot_id.to_string());
    let manifest = tokio::task::spawn_blocking(move || -> AppResult<Manifest> {
        let m = load(&r2, &iid, &sid)?;
        verify(&r2, &m)?;
        Ok(m)
    })
    .await??;
    let prog = Progress::from(progress);
    prog.message("Aktueller Stand wird gesichert …");
    // Gleiche Bereiche wie der wiederhergestellte Snapshot: genau das, was gleich überschrieben wird
    let current_version = manifest.migration.as_ref().map(|_| GameVersion::from(&inst));
    create_locked(state, instance_id, RESTORE_NAME, true, manifest.sel(), prog.sub(0.0, 0.5), vec![snapshot_id.to_string()], current_version).await?;
    prog.check()?;
    // Ab hier nicht mehr abbrechen – sonst bliebe ein halber Stand zurück
    let paths = state.paths.clone();
    let iid = instance_id.to_string();
    let p2 = prog.sub(0.5, 1.0);
    let migration = manifest.migration.clone();
    let res = tokio::task::spawn_blocking(move || restore_sync(&root, &iid, &paths.game_dir(&iid), &paths.instance_dir(&iid), &manifest, &p2)).await?;
    if res.is_ok() {
        // Ordner-Sync: der alte Stand darf nicht als „in der Instanz gelöscht“ in den gemeinsamen Ordner wandern
        crate::platform::optsync::forget_state(&state.paths.root, instance_id);
        // Modpack-Instanzen: Minecraft/Loader wieder auf den wiederhergestellten Pack-Stand setzen
        if let Some(MigrationState { version, pending_mods }) = migration {
            missing::replace_pending_mods(&state.paths, instance_id, pending_mods)?;
            state.instances.set_game_version(instance_id, version.mc_version, version.loader)?;
        } else if let Err(e) = crate::content::modpack::sync_instance_with_record(state, instance_id) {
            tracing::warn!("Instanz {instance_id} nicht an pack.json angeglichen: {e}");
        }
    }
    state.content.emit_changed(instance_id);
    res
}

pub async fn list(state: &AppState, instance_id: &str) -> AppResult<Vec<SnapshotInfo>> {
    let inst = state.instances.get(instance_id)?;
    let root = backups_root(&state.paths);
    let id = instance_id.to_string();
    // Snapshots einer früher gelöschten Instanz mit gleicher ID (älter als die Instanz) verwerfen
    let stale: Vec<String> = manifests(&root, &id).iter().filter(|m| m.created < inst.created_at).map(|m| m.id.clone()).collect();
    if !stale.is_empty() {
        let _g = LOCK.lock().await;
        let r2 = root.clone();
        let dir = snapshot_dir(&root, &id);
        tokio::task::spawn_blocking(move || {
            for s in stale {
                let _ = std::fs::remove_file(dir.join(format!("{s}.json")));
            }
            if let Err(e) = gc(&r2) {
                tracing::warn!("Snapshot-Speicher nicht aufgeräumt: {e}");
            }
        })
        .await?;
    }
    Ok(tokio::task::spawn_blocking(move || manifests(&root, &id).iter().map(Manifest::info).collect()).await?)
}

pub async fn delete(state: &AppState, instance_id: &str, snapshot_id: &str) -> AppResult<()> {
    check_id(snapshot_id, "Snapshot-ID")?;
    let _g = LOCK.lock().await;
    let root = backups_root(&state.paths);
    let p = snapshot_dir(&root, instance_id).join(format!("{snapshot_id}.json"));
    if !valid_name(instance_id) || !p.exists() {
        return Err(AppError::NotFound("Snapshot".into()));
    }
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        std::fs::remove_file(&p)?;
        if let Err(e) = gc(&root) {
            tracing::warn!("Snapshot-Speicher nicht aufgeräumt: {e}");
        }
        Ok(())
    })
    .await??;
    state.content.emit_changed(instance_id);
    Ok(())
}
