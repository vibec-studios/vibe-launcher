use super::*;

pub struct InstanceStore {
    pub(super) paths: Paths,
    pub(super) app: AppHandle,
    pub(super) map: RwLock<HashMap<String, Instance>>,
}

pub(super) fn slugify(name: &str) -> String {
    let mut s = String::new();
    let mut dash = false;
    for c in name.chars() {
        let c = match c {
            'ä' | 'Ä' => Some("ae"),
            'ö' | 'Ö' => Some("oe"),
            'ü' | 'Ü' => Some("ue"),
            'ß' => Some("ss"),
            _ => None,
        }
        .map(|r| r.to_string())
        .unwrap_or_else(|| c.to_ascii_lowercase().to_string());
        for ch in c.chars() {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' {
                s.push(ch);
                dash = false;
            } else if !dash && !s.is_empty() {
                s.push('-');
                dash = true;
            }
        }
    }
    let s = s.trim_matches(|c| c == '-' || c == '.').to_string();
    if s.is_empty() { "instance".into() } else { s.chars().take(48).collect() }
}

impl InstanceStore {
    pub fn load(paths: Paths, app: AppHandle) -> Arc<Self> {
        let mut map = HashMap::new();
        if let Ok(rd) = std::fs::read_dir(paths.instances()) {
            for e in rd.flatten() {
                let p = e.path().join("instance.json");
                match std::fs::read(&p).map(|b| serde_json::from_slice::<Instance>(&b)) {
                    Ok(Ok(mut inst)) => {
                        // Ordnername ist die Wahrheit
                        inst.id = e.file_name().to_string_lossy().to_string();
                        if inst.install_state == InstallState::Installing {
                            inst.install_state = InstallState::NotInstalled;
                        }
                        map.insert(inst.id.clone(), inst);
                    }
                    Ok(Err(err)) => tracing::warn!("Instanz {:?} unlesbar: {err}", p),
                    Err(_) => {}
                }
            }
        }
        Arc::new(InstanceStore { paths, app, map: RwLock::new(map) })
    }

    pub fn list(&self) -> Vec<Instance> {
        let mut v: Vec<Instance> = self.map.read().values().cloned().collect();
        v.sort_by(|a, b| b.last_played.unwrap_or(0).cmp(&a.last_played.unwrap_or(0)).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        v
    }

    pub fn get(&self, id: &str) -> AppResult<Instance> {
        self.map.read().get(id).cloned().ok_or_else(|| AppError::NotFound(format!("Instanz {id}")))
    }

    /// Freier Anzeigename: `Name`, `Name (2)`, `Name (3)` … (Groß-/Kleinschreibung egal). Für automatisch
    /// angelegte Instanzen (z. B. „Vibey Client“), damit nicht zwei gleich heißen.
    pub fn unique_name(&self, base: &str) -> String {
        let map = self.map.read();
        free_name(base, |n| map.values().any(|i| i.name.trim().eq_ignore_ascii_case(n)))
    }

    pub(super) fn unique_id(&self, name: &str) -> String {
        let base = slugify(name);
        let map = self.map.read();
        let mut id = base.clone();
        let mut n = 2;
        while map.contains_key(&id) || self.paths.instance_dir(&id).exists() {
            id = format!("{base}-{n}");
            n += 1;
        }
        id
    }

    pub(super) fn persist(&self, inst: &Instance) -> AppResult<()> {
        write_json_atomic(&self.paths.instance_json(&inst.id), inst)
    }

    pub fn create(&self, req: CreateInstance) -> AppResult<Instance> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(AppError::Invalid("Name darf nicht leer sein".into()));
        }
        if req.mc_version.trim().is_empty() {
            return Err(AppError::Invalid("Minecraft-Version fehlt".into()));
        }
        icon::check(req.icon.as_deref())?;
        let id = self.unique_id(name);
        let inst = Instance {
            id: id.clone(),
            name: name.to_string(),
            icon: req.icon,
            accent: req.accent,
            group: req.group.filter(|g| !g.trim().is_empty()),
            mc_version: req.mc_version,
            loader: req.loader,
            java: Default::default(),
            window: Default::default(),
            hooks: Default::default(),
            source: None,
            install_state: InstallState::NotInstalled,
            version_id: None,
            created_at: now_ms(),
            last_played: None,
            play_time_secs: 0,
            notes: None,
            auto_update_content: None,
            bedrock: None,
        };
        std::fs::create_dir_all(self.paths.game_dir(&id))?;
        self.persist(&inst)?;
        self.map.write().insert(id, inst.clone());
        events::emit(&self.app, events::INSTANCE_CHANGED, &inst);
        Ok(inst)
    }

    /// Neue Bedrock-Instanz (ohne Java-Teile). Der Profilordner entsteht erst beim ersten Bedarf.
    pub fn create_bedrock(&self, name: &str, opts: BedrockOptions, icon: Option<String>, accent: Option<String>, group: Option<String>) -> AppResult<Instance> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::Invalid("Name darf nicht leer sein".into()));
        }
        icon::check(icon.as_deref())?;
        let inst = Instance {
            id: String::new(),
            name: name.to_string(),
            icon,
            accent,
            group: group.filter(|g| !g.trim().is_empty()),
            mc_version: BEDROCK_VERSION.into(),
            loader: Loader { kind: LoaderKind::Vanilla, version: None },
            java: Default::default(),
            window: Default::default(),
            hooks: Default::default(),
            source: None,
            // Bedrock wird nicht vom Launcher installiert
            install_state: InstallState::Installed,
            version_id: None,
            created_at: now_ms(),
            last_played: None,
            play_time_secs: 0,
            notes: None,
            auto_update_content: Some(false),
            bedrock: Some(opts),
        };
        self.insert_new(inst)
    }

    /// Beliebige Änderung an einer Instanz (persistiert + Event).
    pub fn modify<F: FnOnce(&mut Instance)>(&self, id: &str, f: F) -> AppResult<Instance> {
        let inst = {
            let mut map = self.map.write();
            let inst = map.get_mut(id).ok_or_else(|| AppError::NotFound(format!("Instanz {id}")))?;
            let before_version = (inst.mc_version.clone(), inst.loader.clone());
            f(inst);
            if (inst.mc_version.clone(), inst.loader.clone()) != before_version {
                inst.install_state = InstallState::NotInstalled;
                inst.version_id = None;
            }
            inst.clone()
        };
        self.persist(&inst)?;
        events::emit(&self.app, events::INSTANCE_CHANGED, &inst);
        Ok(inst)
    }

    pub fn patch(&self, id: &str, p: InstancePatch) -> AppResult<Instance> {
        icon::check(p.icon.as_ref().and_then(|v| v.as_deref()))?;
        if let Some(n) = &p.name {
            if n.trim().is_empty() {
                return Err(AppError::Invalid("Name darf nicht leer sein".into()));
            }
        }
        self.modify(id, |i| {
            if let Some(v) = p.name { i.name = v.trim().to_string(); }
            if let Some(v) = p.icon { i.icon = v; }
            if let Some(v) = p.accent { i.accent = v; }
            if let Some(v) = p.group { i.group = v.filter(|g| !g.trim().is_empty()); }
            if let Some(v) = p.mc_version { i.mc_version = v; }
            if let Some(v) = p.loader { i.loader = v; }
            if let Some(v) = p.java { i.java = v; }
            if let Some(v) = p.window { i.window = v; }
            if let Some(v) = p.hooks { i.hooks = v; }
            if let Some(v) = p.notes { i.notes = v; }
            if let Some(v) = p.auto_update_content { i.auto_update_content = v; }
            if let (Some(v), true) = (p.bedrock, i.bedrock.is_some()) { i.bedrock = Some(v); }
        })
    }

    pub fn set_game_version(&self, id: &str, mc_version: String, loader: Loader) -> AppResult<()> {
        let mut map = self.map.write();
        let inst = map.get_mut(id).ok_or_else(|| AppError::NotFound(format!("Instanz {id}")))?;
        if inst.mc_version == mc_version && inst.loader == loader {
            return Ok(());
        }
        let mut next = inst.clone();
        next.mc_version = mc_version;
        next.loader = loader;
        next.install_state = InstallState::NotInstalled;
        next.version_id = None;
        self.persist(&next)?;
        *inst = next.clone();
        drop(map);
        events::emit(&self.app, events::INSTANCE_CHANGED, &next);
        Ok(())
    }

    /// Instanz mit vorgegebenem Inhalt registrieren (Import). Legt Ordner an.
    pub fn insert_new(&self, mut inst: Instance) -> AppResult<Instance> {
        inst.id = self.unique_id(&inst.name);
        std::fs::create_dir_all(self.paths.game_dir(&inst.id))?;
        self.persist(&inst)?;
        self.map.write().insert(inst.id.clone(), inst.clone());
        events::emit(&self.app, events::INSTANCE_CHANGED, &inst);
        Ok(inst)
    }

    /// Nur den Eintrag aus dem Speicher entfernen (z. B. wenn ein Import fehlschlägt).
    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.map.write().remove(id);
        let dir = self.paths.instance_dir(id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        events::emit(&self.app, events::INSTANCE_REMOVED, &serde_json::json!({ "id": id }));
        Ok(())
    }

    pub fn duplicate(&self, id: &str, name: Option<String>) -> AppResult<Instance> {
        let src = self.get(id)?;
        let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| format!("{} (Kopie)", src.name));
        let new_id = self.unique_id(&name);
        crate::util::copy_dir_all(&self.paths.instance_dir(id), &self.paths.instance_dir(&new_id))?;
        let mut inst = src.clone();
        inst.id = new_id.clone();
        inst.name = name;
        inst.created_at = now_ms();
        inst.last_played = None;
        inst.play_time_secs = 0;
        // Icon mitkopiert? Pfad auf neue Instanz umbiegen
        if let Some(icon) = &src.icon {
            let old_dir = self.paths.instance_dir(id);
            if let Ok(rel) = std::path::Path::new(icon).strip_prefix(&old_dir) {
                inst.icon = Some(self.paths.instance_dir(&new_id).join(rel).to_string_lossy().to_string());
            }
        }
        self.persist(&inst)?;
        self.map.write().insert(new_id, inst.clone());
        events::emit(&self.app, events::INSTANCE_CHANGED, &inst);
        Ok(inst)
    }

    /// Icon-Datei in den Instanzordner kopieren und setzen.
    pub fn set_icon_from_file(&self, id: &str, src: &std::path::Path) -> AppResult<Instance> {
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png").to_ascii_lowercase();
        if !["png", "jpg", "jpeg", "webp", "gif"].contains(&ext.as_str()) {
            return Err(AppError::Invalid("Nur PNG, JPG, WEBP oder GIF".into()));
        }
        let dest = self.paths.instance_dir(id).join(format!("icon.{ext}"));
        std::fs::copy(src, &dest)?;
        let dest_s = dest.to_string_lossy().to_string();
        self.modify(id, |i| i.icon = Some(dest_s))
    }
}

/// `base`, sonst `base (2)`, `base (3)` … – der erste Name, den `taken` nicht kennt.
pub(super) fn free_name(base: &str, taken: impl Fn(&str) -> bool) -> String {
    let base = base.trim();
    if !taken(base) {
        return base.to_string();
    }
    (2..).map(|n| format!("{base} ({n})")).find(|n| !taken(n)).unwrap_or_else(|| base.to_string())
}
