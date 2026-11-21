use super::*;

/// Vor dem Start: Master-Profil in die Instanz schreiben (falls aktiviert). Gibt die Zahl der Einstellungen zurück.
/// Muss unter [`LOCK`] laufen (siehe [`before_launch`], [`apply_all`]).
pub fn apply(
    root: &Path,
    game_dir: &Path,
    instance_id: &str,
    mc_version: &str,
) -> AppResult<usize> {
    let cfg = SyncConfig::load(&config_path(root));
    let inst = cfg.for_instance(instance_id);
    if !inst.enabled {
        return Ok(0);
    }
    let cats = inst.option_categories();
    let packs = cfg.resource_packs.clone().filter(|_| inst.has("resourcepacks") && !is_pre_113(mc_version));
    let mut n = 0;
    if !cats.is_empty() || packs.is_some() {
        let path = game_dir.join("options.txt");
        let existing = match std::fs::read_to_string(&path) {
            Ok(existing) => existing,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(error.into()),
        };
        let modern = modern_keys(&parse_options(&existing)).unwrap_or_else(|| !is_pre_113(mc_version));
        let mut master = cfg.master.clone();
        if !modern {
            master.extend(cfg.legacy_keybinds);
        }
        let mut opts = parse_options(&merge_into(&existing, &master, &cats, modern));
        n += master.iter()
            .filter(|(k, v)| {
                category_of(k).is_some_and(|c| cats.iter().any(|x| x == c)
                    && (c != "keybinds" || modern_binding(v) == modern))
            })
            .count();
        if let Some(p) = &packs {
            write_packs(&mut opts, p);
            n += 1;
        }
        if n > 0 {
            std::fs::create_dir_all(game_dir)?;
            std::fs::write(&path, render_options(&opts))?;
        }
        if packs.is_some() || !cats.is_empty() {
            let mut st = InstanceState::load(root, instance_id);
            if packs.is_some() {
                st.packs_applied = packs;
            }
            if !cats.is_empty() {
                st.options_applied = Some(applied_options(&opts, &cats, modern));
            }
            st.save(root, instance_id)?;
        }
    }
    // OptiFine (nur wenn es in der Instanz schon eine optionsof.txt gibt)
    if inst.has("video") && !cfg.optifine.is_empty() {
        let p = game_dir.join("optionsof.txt");
        if let Ok(text) = std::fs::read_to_string(&p) {
            let mut opts = parse_options(&text);
            for (k, v) in &cfg.optifine {
                set_opt(&mut opts, k, v.clone());
            }
            std::fs::write(&p, render_options(&opts))?;
            n += 1;
        }
    }
    if inst.has("shaderpacks") {
        if let Some(sel) = &cfg.shader {
            n += write_shader(game_dir, sel)?;
        }
    }
    Ok(n)
}

/// Nach dem Beenden: Änderungen aus dem Spiel zurück ins Master-Profil holen. `since` = Start der Sitzung (ms).
pub fn pull(root: &Path, game_dir: &Path, instance_id: &str, mc_version: &str, since: Option<i64>) -> AppResult<usize> {
    let p = config_path(root);
    let mut cfg = SyncConfig::load(&p);
    let inst = cfg.for_instance(instance_id);
    if !inst.enabled {
        return Ok(0);
    }
    let cats = inst.option_categories();
    let mut n = 0;
    let mut changed = false;
    if let Ok(text) = std::fs::read_to_string(game_dir.join("options.txt")) {
        if !cats.is_empty() {
            let st = InstanceState::load(root, instance_id);
            let captured = capture_options(&mut cfg, &text, &cats, mc_version, st.options_applied.as_ref(), false);
            n += captured;
            changed |= captured > 0;
        }
        if inst.has("resourcepacks") && !is_pre_113(mc_version) {
            let after = parse_options(&text).into_iter().find(|(k, _)| k == "resourcePacks").and_then(|(_, v)| parse_pack_list(&v));
            if let Some(after) = after {
                let st = InstanceState::load(root, instance_id);
                let dropped = dropped_by_game(game_dir, since);
                let rp = game_dir.join("resourcepacks");
                let protected = |x: &String| dropped.contains(x) || x.strip_prefix("file/").is_some_and(|f| !rp.join(f).exists());
                cfg.resource_packs = Some(pull_packs(cfg.resource_packs.as_deref(), st.packs_applied.as_deref(), &after, protected));
                n += 1;
                changed = true;
            }
        }
    }
    if inst.has("video") {
        if let Ok(text) = std::fs::read_to_string(game_dir.join("optionsof.txt")) {
            for (k, v) in parse_options(&text) {
                if k.starts_with("of") && !OPTIFINE_SKIP.contains(&k.as_str()) {
                    cfg.optifine.insert(k, v);
                }
            }
            changed = true;
        }
    }
    if inst.has("shaderpacks") {
        if let Some(mut sel) = read_shader(game_dir) {
            if sel.pack.is_empty() {
                sel.pack = cfg.shader.as_ref().map(|s| s.pack.clone()).unwrap_or_default();
            }
            cfg.shader = Some(sel);
            changed = true;
        }
    }
    if changed {
        cfg.source = Some(instance_id.to_string());
        cfg.updated_at = Some(chrono::Utc::now().timestamp_millis());
        cfg.save(&p)?;
    }
    Ok(n)
}

/// Master-Profil der gewählten Bereiche aus einer Instanz übernehmen (ersetzt deren Werte). Gibt die Anzahl zurück.
pub fn capture_from(root: &Path, game_dir: &Path, instance_id: &str, mc_version: &str, areas: &[String]) -> AppResult<usize> {
    let _g = LOCK.lock();
    let p = config_path(root);
    let mut cfg = SyncConfig::load(&p);
    let cats: Vec<String> = areas.iter().filter(|c| CATEGORIES.contains(&c.as_str())).cloned().collect();
    let text = std::fs::read_to_string(game_dir.join("options.txt"));
    let mut n = 0;
    if !cats.is_empty() {
        let text = text.as_deref().map_err(|_| crate::error::AppError::NotFound("Diese Instanz hat noch keine options.txt – einmal starten und Einstellungen vornehmen".into()))?;
        n += capture_options(&mut cfg, text, &cats, mc_version, None, true);
    }
    let has = |a: &str| areas.iter().any(|x| x == a);
    if has("resourcepacks") && !is_pre_113(mc_version) {
        if let Some(list) = text.as_deref().ok().and_then(|t| parse_options(t).into_iter().find(|(k, _)| k == "resourcePacks")).and_then(|(_, v)| parse_pack_list(&v)) {
            cfg.resource_packs = Some(list);
            n += 1;
        }
    }
    if has("video") {
        if let Ok(t) = std::fs::read_to_string(game_dir.join("optionsof.txt")) {
            cfg.optifine = parse_options(&t).into_iter().filter(|(k, _)| k.starts_with("of") && !OPTIFINE_SKIP.contains(&k.as_str())).collect();
        }
    }
    if has("shaderpacks") {
        if let Some(sel) = read_shader(game_dir) {
            cfg.shader = Some(sel);
            n += 1;
        }
    }
    for area in personal::AREAS {
        if has(area) {
            n += personal::capture(root, game_dir, area, mc_version)?;
        }
    }
    cfg.source = Some(instance_id.to_string());
    cfg.updated_at = Some(chrono::Utc::now().timestamp_millis());
    cfg.save(&p)?;
    Ok(n)
}
