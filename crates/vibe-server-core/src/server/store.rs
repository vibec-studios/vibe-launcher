use super::*;

/// Speicher aller Server (`servers/<id>/vibe-server.json`).
pub struct ServerStore {
    pub(super) paths: Paths,
    pub(super) events: Sink,
    pub(super) map: RwLock<HashMap<String, Server>>,
}



pub(super) fn slug(name: &str) -> String {
    let mut s = String::new();
    for c in name.to_lowercase().chars() {
        let rep = match c {
            'ä' => "ae".to_string(),
            'ö' => "oe".to_string(),
            'ü' => "ue".to_string(),
            'ß' => "ss".to_string(),
            c if c.is_ascii_alphanumeric() || c == '.' || c == '_' => c.to_string(),
            _ => "-".to_string(),
        };
        if rep == "-" && (s.is_empty() || s.ends_with('-')) {
            continue;
        }
        s.push_str(&rep);
    }
    let s = s.trim_matches(['-', '.']).chars().take(40).collect::<String>();
    if s.is_empty() { "server".into() } else { s }
}



impl ServerStore {
    pub fn load(paths: Paths, events: Sink) -> Arc<Self> {
        let mut map = HashMap::new();
        if let Ok(rd) = std::fs::read_dir(servers_root(&paths)) {
            for e in rd.flatten() {
                let p = e.path().join(META_FILE);
                if let Ok(b) = std::fs::read(&p) {
                    match serde_json::from_slice::<Server>(&b) {
                        Ok(mut s) => {
                            s.id = e.file_name().to_string_lossy().to_string();
                            if s.install_state == InstallState::Installing {
                                s.install_state = InstallState::NotInstalled;
                            }
                            map.insert(s.id.clone(), s);
                        }
                        Err(err) => tracing::warn!("Server {:?} unlesbar: {err}", p),
                    }
                }
            }
        }
        Arc::new(ServerStore { paths, events, map: RwLock::new(map) })
    }

    pub fn list(&self) -> Vec<Server> {
        let mut v: Vec<Server> = self.map.read().values().cloned().collect();
        v.sort_by_key(|s| std::cmp::Reverse(s.created_at));
        v
    }

    pub fn get(&self, id: &str) -> AppResult<Server> {
        self.map.read().get(id).cloned().ok_or_else(|| AppError::NotFound(format!("Server {id}")))
    }

    pub(super) fn persist(&self, s: &Server) -> AppResult<()> {
        write_json_atomic(&server_dir(&self.paths, &s.id).join(META_FILE), s)
    }

    pub(super) fn emit(&self, s: &Server) {
        crate::events::emit(&self.events, EV_CHANGED, s);
    }

    /// Freier Port ab 25565, der von keinem anderen Server belegt ist.
    pub fn free_port(&self, exclude: Option<&str>) -> u16 {
        let used: Vec<u16> = self.map.read().values().filter(|s| Some(s.id.as_str()) != exclude).map(|s| s.port).collect();
        let mut p = 25565u16;
        while used.contains(&p) || !run::port_free(p) {
            p += 1;
            if p > 25665 {
                return 25565;
            }
        }
        p
    }

    pub(super) fn free_slot(&self) -> u32 {
        let used: Vec<u32> = self.map.read().values().map(|s| s.relay_slot).collect();
        (crate::product::get().relay_slot_base.max(1)..).find(|n| !used.contains(n)).unwrap_or(1)
    }

    pub fn create(&self, req: &ServerCreate) -> AppResult<Server> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(AppError::Invalid("Name darf nicht leer sein".into()));
        }
        if req.mc_version.trim().is_empty() {
            return Err(AppError::Invalid("Minecraft-Version fehlt".into()));
        }
        let base = slug(name);
        let id = {
            let map = self.map.read();
            let mut id = base.clone();
            let mut n = 2;
            while map.contains_key(&id) || server_dir(&self.paths, &id).exists() {
                id = format!("{base}-{n}");
                n += 1;
            }
            id
        };
        let port = req.port.filter(|p| *p > 0).unwrap_or_else(|| self.free_port(None));
        // Aus einer Instanz übernommene Server sind Mod-Server (Loader der Instanz)
        let platform = if req.from_instance.is_some() { None } else { req.platform.clone() };
        let s = Server {
            id: id.clone(),
            name: name.to_string(),
            icon: None,
            accent: None,
            mc_version: req.mc_version.trim().to_string(),
            loader: if platform.is_some() { Loader { kind: crate::model::LoaderKind::Vanilla, version: None } } else { req.loader.clone() },
            platform,
            memory_mb: req.memory_mb,
            java_path: None,
            jvm_args: None,
            port,
            auto_start: false,
            auto_restart: true,
            connection: ServerConnection::Local,
            eula: false,
            install_state: InstallState::NotInstalled,
            created_at: now_ms(),
            last_started: None,
            source_instance: req.from_instance.clone(),
            relay_slot: self.free_slot(),
            launch: None,
            voice: false,
            bedrock: false,
        };
        std::fs::create_dir_all(server_dir(&self.paths, &id))?;
        self.persist(&s)?;
        self.map.write().insert(id, s.clone());
        self.emit(&s);
        Ok(s)
    }

    pub fn modify<F: FnOnce(&mut Server)>(&self, id: &str, f: F) -> AppResult<Server> {
        let s = {
            let mut map = self.map.write();
            let s = map.get_mut(id).ok_or_else(|| AppError::NotFound(format!("Server {id}")))?;
            f(s);
            s.clone()
        };
        self.persist(&s)?;
        self.emit(&s);
        Ok(s)
    }

    pub fn patch(&self, id: &str, p: ServerPatch) -> AppResult<Server> {
        if let Some(n) = &p.name {
            if n.trim().is_empty() {
                return Err(AppError::Invalid("Name darf nicht leer sein".into()));
            }
        }
        if let Some(port) = p.port {
            if port == 0 {
                return Err(AppError::Invalid("Port muss zwischen 1 und 65535 liegen".into()));
            }
            let clash = self.map.read().values().any(|s| s.id != id && s.port == port);
            if clash {
                return Err(AppError::Invalid(format!("Port {port} wird schon von einem anderen Server verwendet")));
            }
        }
        self.modify(id, |s| {
            if let Some(v) = p.name { s.name = v.trim().to_string(); }
            if let Some(v) = p.accent { s.accent = v; }
            if let Some(v) = p.memory_mb { s.memory_mb = v.map(|m| m.clamp(512, 1024 * 256)); }
            if let Some(v) = p.java_path { s.java_path = v.filter(|x| !x.trim().is_empty()); }
            if let Some(v) = p.jvm_args { s.jvm_args = v.filter(|x| !x.trim().is_empty()); }
            if let Some(v) = p.port { s.port = v; }
            if let Some(v) = p.auto_start { s.auto_start = v; }
            if let Some(v) = p.auto_restart { s.auto_restart = v; }
            if let Some(v) = p.connection { s.connection = v; }
        })
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.map.write().remove(id);
        let dir = server_dir(&self.paths, id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| AppError::msg(format!("Server-Ordner konnte nicht gelöscht werden (Datei in Benutzung?): {e}")))?;
        }
        crate::events::emit(&self.events, EV_REMOVED, &serde_json::json!({ "id": id }));
        Ok(())
    }
}
