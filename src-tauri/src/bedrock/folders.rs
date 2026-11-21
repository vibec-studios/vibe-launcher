use super::*;

/// `<daten>/bedrock/` – Journal, Parkplatz, Sicherungen.
pub fn launcher_dir(paths: &Paths) -> PathBuf {
    paths.root.join("bedrock")
}

/// Eigenes Profil einer Instanz (Slots wie im echten Ordner).
pub fn profile_dir(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.instance_dir(instance_id).join("bedrock")
}

pub fn swapper(paths: &Paths, t: &Target) -> swap::Swapper {
    let dir = launcher_dir(paths);
    swap::Swapper {
        target: t.base.clone(),
        layout: t.layout,
        park: dir.join("park").join(t.channel.as_str()),
        journal: dir.join(format!("swap-{}.json", t.channel.as_str())),
        rescue: dir.join("rescue"),
    }
}

/// Kanal/Profil einer Instanz, Fehler bei Java-Instanzen.
pub fn options(inst: &Instance) -> AppResult<crate::instance::BedrockOptions> {
    inst.bedrock.ok_or_else(|| AppError::Invalid(format!("„{}“ ist keine Bedrock-Instanz", inst.name)))
}

/// Wo die Daten einer Instanz gerade liegen: im echten Ordner (gemeinsames Profil oder gerade eingetauscht)
/// oder im eigenen Profilordner.
#[derive(Debug, Clone)]
pub struct DataLoc {
    pub base: PathBuf,
    pub layout: Layout,
    /// Liegt im echten Spielordner
    pub live: bool,
}

impl DataLoc {
    pub fn packs_dir(&self) -> PathBuf {
        slot_path(&self.base, &self.layout.packs_slot())
    }
    /// Alle Weltordner-Wurzeln (`…/com.mojang/minecraftWorlds`) mit Slot-Namen, die existieren.
    pub fn world_dirs(&self) -> Vec<(String, PathBuf)> {
        self.layout
            .world_slots(&self.base)
            .into_iter()
            .map(|s| {
                let p = slot_path(&self.base, &s).join("minecraftWorlds");
                (s, p)
            })
            .collect()
    }
}

pub fn data_loc(paths: &Paths, inst: &Instance) -> AppResult<DataLoc> {
    let o = options(inst)?;
    let t = target(o.channel)?;
    let sw = swapper(paths, &t);
    let active = sw.active_instance();
    if o.profile == BedrockProfile::Shared {
        // Während eine Instanz mit eigenem Profil eingetauscht ist, liegen im echten Ordner deren Daten
        if active.is_some() {
            return Err(AppError::Invalid(SWAPPED_MSG.into()));
        }
        return Ok(DataLoc { base: t.base, layout: t.layout, live: true });
    }
    if active.as_deref() == Some(inst.id.as_str()) {
        return Ok(DataLoc { base: t.base, layout: t.layout, live: true });
    }
    Ok(DataLoc { base: profile_dir(paths, &inst.id), layout: t.layout, live: false })
}

/// Meldung, wenn die normalen Bedrock-Daten gerade weggetauscht sind.
pub const SWAPPED_MSG: &str =
    "Gerade ist eine Bedrock-Instanz mit eigenem Profil eingetauscht. Sobald das Spiel geschlossen ist, sind hier wieder deine normalen Bedrock-Daten zu sehen.";

/// Datei/Ordner entfernen: in den Papierkorb (in Tests endgültig).
pub fn discard(p: &Path) -> AppResult<()> {
    if !p.exists() {
        return Ok(());
    }
    if !cfg!(test) && trash::delete(p).is_ok() {
        return Ok(());
    }
    if p.is_dir() {
        std::fs::remove_dir_all(p)?;
    } else {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

/// Ordnergröße (Bytes), Fehler werden übersprungen.
pub fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
}

/// Bild als kleine data:-URL (Icons liegen oft außerhalb des Launcher-Ordners, den das Frontend lesen darf).
pub fn icon_data_url(p: &Path, max: u32) -> Option<String> {
    use base64::Engine;
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > 8 * 1024 * 1024 {
        return None;
    }
    let bytes = std::fs::read(p).ok()?;
    let img = image::load_from_memory(&bytes).ok()?;
    let img = if img.width() > max || img.height() > max { img.thumbnail(max, max) } else { img };
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())))
}
