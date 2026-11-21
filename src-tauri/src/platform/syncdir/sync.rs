use super::*;

/// Instanzordner `inst` mit dem gemeinsamen Ordner `shared` abgleichen. `suffix` (Instanzname) benennt
/// Konfliktfassungen. `base` wird auf den neuen Stand gebracht (bei Fehlern bleibt der Eintrag offen und wird beim
/// nächsten Mal erneut versucht).
pub fn sync(inst: &Path, shared: &Path, trash: &Path, base: &mut Base, suffix: &str) -> AppResult<DirReport> {
    if is_link(inst) {
        // Selbst angelegte Verknüpfung (Junction/Symlink): nicht hineinschreiben, sonst träfe es fremde Ordner
        return Ok(DirReport { errors: vec!["Der Ordner ist eine Verknüpfung und wird nicht abgeglichen".into()], ..Default::default() });
    }
    std::fs::create_dir_all(inst)?;
    std::fs::create_dir_all(shared)?;
    let li = entries(inst);
    let ls = entries(shared);
    let names: BTreeSet<String> = li.keys().chain(ls.keys()).chain(base.keys()).cloned().collect();
    let mut rep = DirReport::default();
    for name in names {
        let (ip, sp) = (inst.join(&name), shared.join(&name));
        let i = li.get(&name).copied();
        let s = ls.get(&name).copied();
        let b = base.get(&name).cloned().unwrap_or_default();
        let ic = i != b.inst;
        let sc = s != b.shared;
        let res: std::io::Result<()> = (|| {
            match (ic, sc, i.is_some(), s.is_some()) {
                (false, false, ..) => {}
                // Nur in der Instanz geändert
                (true, false, true, _) => {
                    place(&ip, &sp)?;
                    rep.to_shared.push(name.clone());
                }
                (true, false, false, true) => {
                    to_trash(&sp, trash)?;
                    rep.removed_shared.push(name.clone());
                }
                (true, false, false, false) => {}
                // Nur im gemeinsamen Ordner geändert
                (false, true, _, true) => {
                    place(&sp, &ip)?;
                    rep.to_instance.push(name.clone());
                }
                (false, true, true, false) => {
                    remove_any(&ip)?;
                    rep.removed_instance.push(name.clone());
                }
                (false, true, false, false) => {}
                // Beide Seiten geändert
                (true, true, false, false) => {}
                (true, true, true, false) => {
                    place(&ip, &sp)?;
                    rep.to_shared.push(name.clone());
                }
                (true, true, false, true) => {
                    place(&sp, &ip)?;
                    rep.to_instance.push(name.clone());
                }
                (true, true, true, true) => {
                    if !same_content(&ip, &sp) {
                        let is_dir = ip.is_dir();
                        let renamed = unique_name(&name, suffix, &[inst, shared], is_dir);
                        let (ip2, sp2) = (inst.join(&renamed), shared.join(&renamed));
                        std::fs::rename(&ip, &ip2)?;
                        place(&ip2, &sp2)?;
                        place(&sp, &ip)?;
                        base.insert(renamed.clone(), BaseEntry { inst: stamp(&ip2), shared: stamp(&sp2) });
                        rep.conflicts.push(Conflict { name: name.clone(), renamed });
                    }
                }
            }
            Ok(())
        })();
        match res {
            Ok(()) => {
                let e = BaseEntry { inst: stamp(&ip), shared: stamp(&sp) };
                if e.inst.is_none() && e.shared.is_none() {
                    base.remove(&name);
                } else {
                    base.insert(name, e);
                }
            }
            Err(e) => {
                tracing::warn!("Sync: {name} übersprungen: {e}");
                rep.errors.push(format!("{name}: {e}"));
            }
        }
    }
    prune_trash(trash);
    Ok(rep)
}

/// Einseitig sammeln (Screenshots): neue Dateien der Instanz zusätzlich in den gemeinsamen Ordner legen. Bereits
/// gesammelte (`seen`) werden nicht erneut übertragen – im gemeinsamen Ordner gelöschte Bilder kommen also nicht
/// wieder. Gibt die Anzahl neu gesammelter Dateien zurück.
pub fn collect(inst: &Path, shared: &Path, seen: &mut BTreeSet<String>, suffix: &str) -> AppResult<usize> {
    if is_link(inst) {
        return Ok(0);
    }
    let Ok(rd) = std::fs::read_dir(inst) else { return Ok(0) };
    std::fs::create_dir_all(shared)?;
    let mut present = BTreeSet::new();
    let mut n = 0;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if ignored(&name) || !e.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        present.insert(name.clone());
        if seen.contains(&name) {
            continue;
        }
        let mut target = shared.join(&name);
        if target.exists() {
            if same_content(&e.path(), &target) {
                seen.insert(name);
                continue;
            }
            target = shared.join(unique_name(&name, suffix, &[shared], false));
        }
        let tmp = tmp_sibling(&target);
        match link_or_copy(&e.path(), &tmp).and_then(|_| std::fs::rename(&tmp, &target)) {
            Ok(()) => {
                seen.insert(name);
                n += 1;
            }
            Err(err) => {
                let _ = std::fs::remove_file(&tmp);
                tracing::warn!("Screenshot {name} nicht gesammelt: {err}");
            }
        }
    }
    // Merkliste klein halten: nur, was die Instanz noch hat
    seen.retain(|s| present.contains(s));
    Ok(n)
}

/// Anzahl Einträge und Gesamtgröße eines Ordners (oberste Ebene, ohne Systemdateien).
pub fn summary(dir: &Path) -> (usize, u64) {
    let e = entries(dir);
    (e.len(), e.values().map(|s| s.size).sum())
}
