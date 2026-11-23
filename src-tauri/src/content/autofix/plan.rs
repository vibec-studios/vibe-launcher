use super::*;

pub(super) struct Builder {
    pub(super) steps: Vec<FixStep>,
    pub(super) unfixable: Vec<Unfixable>,
}

impl Builder {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn step(
        &mut self,
        reason: &str,
        name: &str,
        required_by: Vec<String>,
        action: FixAction,
        alt: Option<(FixAction, String)>,
        confirm: bool,
        cause: Option<usize>,
    ) -> Option<&mut FixStep> {
        if self.steps.iter().any(|s| s.action == action) {
            return None;
        }
        let (alt, alt_name) = match alt {
            Some((a, n)) => (Some(a), Some(n)),
            None => (None, None),
        };
        self.steps.push(FixStep {
            id: format!("s{}", self.steps.len() + 1),
            reason: reason.into(),
            name: name.into(),
            required_by,
            action,
            alt,
            alt_name,
            confirm,
            selected: !confirm,
            from_crash: cause.is_some(),
            cause,
            detail: None,
        });
        self.steps.last_mut()
    }
}

/// Vollständiger Plan für eine Instanz. `crash_report`/`exit_code`: ausdrücklich gewählter Absturz (Crash-Dialog);
/// sonst wird die letzte Sitzung ausgewertet, falls sie abgestürzt ist. `ignore_crash`: nur statisch prüfen
/// (Nachprüfung nach dem Beheben – der alte Absturz ist dann kein Maßstab mehr).
pub async fn plan(state: &AppState, instance_id: &str, crash_report: Option<String>, exit_code: Option<i32>, ignore_crash: bool) -> AppResult<FixPlan> {
    let inst = state.instances.get(instance_id)?;
    let modded = inst.loader.kind != LoaderKind::Vanilla;
    let issues = if modded { deps::check(state, instance_id, false).await? } else { vec![] };
    let crash_src = if ignore_crash {
        None
    } else if crash_report.is_some() || exit_code.is_some() {
        Some((crash_report, exit_code))
    } else {
        last_crash(state, instance_id)
    };
    let crash = crash_src.is_some();
    let (diags, analysis) = match crash_src {
        Some((r, c)) => match crash::analyze_instance_full(state, instance_id, r, c).await {
            Ok(a) => (a.diagnoses, Some(a.info)),
            Err(e) => {
                tracing::warn!("Autofix {instance_id}: Absturzanalyse fehlgeschlagen: {e}");
                (vec![], None)
            }
        },
        None => (vec![], None),
    };
    let (scanned, idx): (Vec<local::Scanned>, ContentIndex) = if modded { local::scan(state, instance_id, ContentKind::Mod).await? } else { (vec![], ContentIndex::default()) };
    let names: HashMap<String, String> = scanned.iter().map(|s| (s.file_name.clone(), s.meta.name.clone().unwrap_or_else(|| display_name(&s.file_name)))).collect();
    let by_file: HashMap<&str, &local::Scanned> = scanned.iter().map(|s| (s.file_name.as_str(), s)).collect();
    let need = needs(&issues, &diags, &names);
    let gate = ModelGate::new(analysis.as_ref().is_some_and(|a| a.vibefix()), &issues, &names);
    let origin = |file: &str| idx.files.get(&index::key("mods", index::strip_disabled(file))).cloned();

    let mut b = Builder { steps: vec![], unfixable: vec![] };
    let mut gone: HashSet<String> = HashSet::new();
    for n in &need {
        match n {
            Need::Disable { file, .. } | Need::Swap { file, .. } | Need::Update { file, .. } => {
                gone.insert(file.clone());
            }
            _ => {}
        }
    }

    for n in need {
        let ask = gate.applies(&n);
        let before = b.steps.len();
        match n {
            Need::Disable { file, name, reason, confirm, alt, cause } => {
                let alt = alt.map(|(f, n)| (FixAction::Disable { file_name: f }, n));
                b.step(&reason, &name, vec![], FixAction::Disable { file_name: file }, alt, confirm, cause);
            }
            Need::Enable { file, name, required_by, cause } => {
                b.step("disabled_dependency", &name, required_by, FixAction::Enable { file_name: file }, None, false, cause);
            }
            Need::Swap { file, name, reason, cause } => {
                // Bei falschem Loader: für welchen Loader die Mod gebaut ist (Anzeige)
                let mod_loader = by_file.get(file.as_str()).and_then(|s| s.meta.loader.clone()).filter(|_| reason == "wrong_loader");
                let o = origin(&file);
                let v = match &o {
                    Some(o) => best(state, &inst, o.source, &o.project_id).await.filter(|v| v.id != o.version_id),
                    None => None,
                };
                match (o, v) {
                    (Some(o), Some(v)) => {
                        let manual = locked(state, &v).await;
                        let title = o.title.clone().unwrap_or_else(|| name.clone());
                        if let Some(s) = b.step(
                            &reason,
                            &name,
                            vec![],
                            FixAction::Replace {
                                file_name: file.clone(),
                                source: o.source,
                                project_id: o.project_id.clone(),
                                version_id: v.id.clone(),
                                title,
                                from_version: o.version_number.clone(),
                                to_version: v.version_number.clone(),
                                manual,
                            },
                            None,
                            false,
                            cause,
                        ) {
                            s.detail = mod_loader.clone();
                        }
                        if manual {
                            // Bis die Datei von Hand geladen ist: alte (unpassende) Datei deaktivieren
                            if let Some(s) = b.step(&reason, &name, vec![], FixAction::Disable { file_name: file }, None, false, cause) {
                                s.detail = mod_loader;
                            }
                        }
                    }
                    (None, _) if reason == "wrong_loader" => {
                        // Von Hand hinzugefügte Datei: passende Variante über die Mod-ID auf Modrinth suchen
                        let mod_id = by_file.get(file.as_str()).and_then(|s| s.meta.mod_id.clone());
                        let variant = match &mod_id {
                            Some(id) => match deps::resolve_modrinth(state, id, &inst).await {
                                Some((pid, title)) if !idx.has_project(Source::Modrinth, &pid) && best(state, &inst, Source::Modrinth, &pid).await.is_some() => Some((pid, title)),
                                _ => None,
                            },
                            None => None,
                        };
                        if let Some(s) = b.step(&reason, &name, vec![], FixAction::Disable { file_name: file }, None, false, cause) {
                            s.detail = mod_loader.clone();
                        }
                        if let Some((pid, title)) = variant {
                            if let Some(s) = b.step(&reason, &title, vec![], FixAction::Install { source: Source::Modrinth, project_id: pid, title: title.clone() }, None, false, cause) {
                                s.detail = mod_loader;
                            }
                        }
                    }
                    _ => {
                        if let Some(s) = b.step(&reason, &name, vec![], FixAction::Disable { file_name: file }, None, false, cause) {
                            s.detail = mod_loader;
                        }
                    }
                }
            }
            Need::Update { file, name, required_by, cause } => {
                let o = origin(&file);
                let v = match &o {
                    Some(o) => best(state, &inst, o.source, &o.project_id).await.filter(|v| v.id != o.version_id),
                    None => None,
                };
                match (o, v) {
                    (Some(o), Some(v)) => {
                        let manual = locked(state, &v).await;
                        b.step(
                            "version_mismatch",
                            &name,
                            vec![required_by],
                            FixAction::Replace {
                                file_name: file,
                                source: o.source,
                                project_id: o.project_id.clone(),
                                version_id: v.id.clone(),
                                title: o.title.clone().unwrap_or_else(|| name.clone()),
                                from_version: o.version_number.clone(),
                                to_version: v.version_number.clone(),
                                manual,
                            },
                            None,
                            false,
                            cause,
                        );
                    }
                    _ => b.unfixable.push(Unfixable { reason: "no_version".into(), name, detail: Some(required_by), cause }),
                }
            }
            Need::Install { dep_id, required_by, required_files, cause } => {
                let found = deps::resolve_modrinth(state, &dep_id, &inst).await;
                let ok = match &found {
                    Some((pid, _)) => !idx.has_project(Source::Modrinth, pid) && best(state, &inst, Source::Modrinth, pid).await.is_some(),
                    None => false,
                };
                match found {
                    Some((pid, title)) if ok => {
                        b.step(
                            "missing_dependency",
                            &title,
                            required_by,
                            FixAction::Install { source: Source::Modrinth, project_id: pid, title: title.clone() },
                            None,
                            false,
                            cause,
                        );
                    }
                    Some((pid, _)) if idx.has_project(Source::Modrinth, &pid) => {}
                    _ => {
                        b.unfixable.push(Unfixable { reason: "dep_not_found".into(), name: dep_id.clone(), detail: Some(required_by.join(", ")), cause });
                        // Ersatzweise (nur nach Rückfrage): die Mods deaktivieren, die die Abhängigkeit brauchen
                        for f in required_files.iter().filter(|f| !gone.contains(*f)) {
                            b.step("dep_not_found", &names.get(f).cloned().unwrap_or_else(|| display_name(f)), vec![], FixAction::Disable { file_name: f.clone() }, None, true, cause);
                        }
                    }
                }
            }
            Need::Java { major, cause } => {
                let all = crate::minecraft::java::list(state).await;
                let path = all.iter().filter(|j| j.major == major).max_by_key(|j| j.managed).map(|j| j.path.clone());
                let current_ok = match inst.java.path.as_deref() {
                    Some(p) => all.iter().any(|j| j.path == p && j.major == major),
                    None => false,
                };
                if !current_ok {
                    b.step("java_version", &format!("Java {major}"), vec![], FixAction::SetJava { major, path }, None, false, cause);
                }
            }
            Need::Ram { mb, cause } => {
                b.step("out_of_memory", "", vec![], FixAction::SetRam { mb }, None, false, cause);
            }
            Need::ResetConfig { path, name, cause } => {
                if config_file(state, instance_id, &path).is_some_and(|p| p.is_file()) {
                    b.step("broken_config", &name, vec![], FixAction::ResetConfig { path }, None, true, cause);
                }
            }
            Need::Unfixable(u) => b.unfixable.push(u),
        }
        if ask {
            ask_all(&mut b.steps[before..]);
        }
    }

    // Loader: Version passt nicht zu den Mods (die aktiv bleiben) / Installation unvollständig
    if modded {
        let files = loaderfix::inspect(&state.paths, &inst);
        let reqs: Vec<deps::LoaderReq> = deps::loader_requirements(&inst, &scanned).into_iter().filter(|r| !gone.contains(&r.file)).collect();
        let available = if loaderfix::needs_versions(&inst, &files, &reqs) {
            match crate::minecraft::loaders::loader_versions(state, inst.loader.kind, &inst.mc_version).await {
                Ok(l) => Some(l),
                Err(e) => {
                    tracing::warn!("Autofix {instance_id}: Loader-Versionen nicht geladen: {e}");
                    None
                }
            }
        } else {
            None
        };
        loader_steps(&inst, loaderfix::loader_needs(&inst, &files, &reqs, available.as_deref()), &mut b);
    }

    // Bekannte unverträgliche Paare (gepflegte Liste) und Konflikte laut Modrinth
    if modded {
        known_pair_steps(&scanned, &gone, &mut b);
        if let Err(e) = known_conflicts(state, &scanned, &idx, &names, &gone, &mut b).await {
            tracing::warn!("Autofix {instance_id}: bekannte Konflikte nicht geprüft: {e}");
        }
    }

    // Loader-Schritte der Absturzursache „Loader-Version“ zuordnen
    if let Some(ci) = diags.iter().position(|d| d.id == "loader_version") {
        for s in b.steps.iter_mut().filter(|s| matches!(s.action, FixAction::SetLoader { .. }) && s.cause.is_none()) {
            s.cause = Some(ci);
            s.from_crash = true;
        }
    }

    Ok(FixPlan { steps: b.steps, unfixable: b.unfixable, crash, causes: diags, analysis })
}
