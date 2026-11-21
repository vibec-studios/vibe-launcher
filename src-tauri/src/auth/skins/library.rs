use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct StoredSkin {
    pub(super) id: String,
    pub(super) name: String,
    #[serde(default)]
    pub(super) variant: SkinVariant,
    pub(super) file: String,
    #[serde(default)]
    pub(super) added_at: i64,
    #[serde(default)]
    pub(super) source: Option<String>,
    #[serde(default)]
    pub(super) sha1: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) cape_id: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct LibraryFile {
    #[serde(default)]
    pub(super) skins: Vec<StoredSkin>,
}

pub struct Library {
    pub(super) dir: PathBuf,
    pub(super) index: PathBuf,
    pub(super) items: Mutex<Vec<StoredSkin>>,
}

impl Library {
    /// `root` = Datenordner des Launchers.
    pub fn load(root: &Path) -> Self {
        let dir = root.join("skins");
        let index = root.join("skins.json");
        let items = std::fs::read(&index)
            .ok()
            .and_then(|b| serde_json::from_slice::<LibraryFile>(&b).ok())
            .map(|f| f.skins)
            .unwrap_or_default()
            .into_iter()
            .filter(|s| dir.join(&s.file).is_file())
            .collect();
        Library { dir, index, items: Mutex::new(items) }
    }

    pub(super) fn save(&self) -> AppResult<()> {
        let f = LibraryFile { skins: self.items.lock().clone() };
        crate::util::write_json_atomic(&self.index, &f)
    }

    pub(super) fn to_public(&self, s: &StoredSkin) -> Option<LibrarySkin> {
        let bytes = std::fs::read(self.dir.join(&s.file)).ok()?;
        Some(LibrarySkin {
            id: s.id.clone(),
            name: s.name.clone(),
            variant: s.variant,
            file: s.file.clone(),
            added_at: s.added_at,
            source: s.source.clone(),
            cape_id: s.cape_id.clone(),
            data_url: data_url(&bytes),
        })
    }

    /// Neueste zuerst.
    pub fn list(&self) -> Vec<LibrarySkin> {
        let items = self.items.lock().clone();
        let mut out: Vec<LibrarySkin> = items.iter().filter_map(|s| self.to_public(s)).collect();
        out.sort_by_key(|s| std::cmp::Reverse(s.added_at));
        out
    }

    pub fn get(&self, id: &str) -> AppResult<LibrarySkin> {
        let s = self.items.lock().iter().find(|s| s.id == id).cloned().ok_or_else(|| AppError::NotFound("Skin".into()))?;
        self.to_public(&s).ok_or_else(|| AppError::NotFound("Skin-Datei".into()))
    }

    pub fn path(&self, id: &str) -> AppResult<PathBuf> {
        let s = self.items.lock().iter().find(|s| s.id == id).cloned().ok_or_else(|| AppError::NotFound("Skin".into()))?;
        Ok(self.dir.join(s.file))
    }

    pub fn bytes(&self, id: &str) -> AppResult<(Vec<u8>, SkinVariant)> {
        let variant = self.items.lock().iter().find(|s| s.id == id).map(|s| s.variant).ok_or_else(|| AppError::NotFound("Skin".into()))?;
        Ok((std::fs::read(self.path(id)?)?, variant))
    }

    /// Skin hinzufügen. Gleiche Datei (SHA-1) schon vorhanden -> vorhandenen Eintrag zurückgeben.
    pub fn add(&self, png: &[u8], name: &str, variant: SkinVariant, source: Option<String>) -> AppResult<LibrarySkin> {
        self.add_with(png, name, variant, source, None)
    }

    /// Einträge für die Skin-Brücke (`play::skin_bridge`): neueste zuerst, mit Pfad und SHA-1 der PNG.
    pub fn bridge_entries(&self) -> Vec<BridgeSkin> {
        let mut items = self.items.lock().clone();
        items.sort_by_key(|s| std::cmp::Reverse(s.added_at));
        items
            .into_iter()
            .filter_map(|s| {
                let path = self.dir.join(&s.file);
                let sha1 = if s.sha1.is_empty() { hex::encode(Sha1::digest(std::fs::read(&path).ok()?)) } else { s.sha1.clone() };
                path.is_file().then(|| BridgeSkin { id: s.id, name: s.name, variant: s.variant, path, sha1, added_at: s.added_at, cape_id: s.cape_id })
            })
            .collect()
    }

    /// SHA-1 aller Bibliotheks-Skins (Duplikaterkennung beim Import).
    pub fn sha1s(&self) -> std::collections::HashSet<String> {
        self.items.lock().iter().map(|s| s.sha1.clone()).filter(|s| !s.is_empty()).collect()
    }

    /// Wie [`add`], optional mit Cape-Zuordnung.
    pub fn add_with(&self, png: &[u8], name: &str, variant: SkinVariant, source: Option<String>, cape_id: Option<String>) -> AppResult<LibrarySkin> {
        validate_skin_png(png)?;
        let sha = hex::encode(Sha1::digest(png));
        if let Some(existing) = self.items.lock().iter().find(|s| s.sha1 == sha).cloned() {
            return self.to_public(&existing).ok_or_else(|| AppError::NotFound("Skin-Datei".into()));
        }
        std::fs::create_dir_all(&self.dir)?;
        let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
        let file = format!("{id}.png");
        std::fs::write(self.dir.join(&file), png)?;
        let name = clean_name(name);
        let stored = StoredSkin { id: id.clone(), name, variant, file, added_at: now_ms(), source, sha1: sha, cape_id };
        self.items.lock().push(stored);
        self.save()?;
        self.get(&id)
    }

    pub fn modify(&self, id: &str, f: impl FnOnce(&mut StoredSkinEdit)) -> AppResult<LibrarySkin> {
        {
            let mut items = self.items.lock();
            let s = items.iter_mut().find(|s| s.id == id).ok_or_else(|| AppError::NotFound("Skin".into()))?;
            let mut e = StoredSkinEdit { name: s.name.clone(), variant: s.variant };
            f(&mut e);
            s.name = clean_name(&e.name);
            s.variant = e.variant;
        }
        self.save()?;
        self.get(id)
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        let removed = {
            let mut items = self.items.lock();
            let pos = items.iter().position(|s| s.id == id).ok_or_else(|| AppError::NotFound("Skin".into()))?;
            items.remove(pos)
        };
        let _ = std::fs::remove_file(self.dir.join(&removed.file));
        self.save()
    }
}

/// Änderbare Felder eines Bibliothekseintrags.
pub struct StoredSkinEdit {
    pub name: String,
    pub variant: SkinVariant,
}

pub(super) fn clean_name(name: &str) -> String {
    let n: String = name.trim().chars().filter(|c| !c.is_control()).take(48).collect();
    if n.trim().is_empty() { "Skin".into() } else { n.trim().to_string() }
}
