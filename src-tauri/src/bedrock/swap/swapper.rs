use super::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    SwappingIn,
    Active,
    SwappingOut,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Journal {
    pub instance_id: String,
    pub phase: Phase,
    /// Slots, die beim Eintauschen im echten Ordner lagen (= Daten des Nutzers, gehen in den Parkplatz)
    pub home_slots: Vec<String>,
    /// Slots, die aus dem Profil der Instanz kamen (nur zur Info)
    pub inst_slots: Vec<String>,
    /// Profilordner der Instanz (absolut)
    pub profile: PathBuf,
    pub started_at: i64,
}

/// Ergebnis des Zurücktauschens.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SwapReport {
    pub instance_id: String,
    /// Ordner, die nicht an ihren Platz passten und nach `rescue/` verschoben wurden
    pub rescued: Vec<PathBuf>,
}

pub struct Swapper {
    /// Echter Datenordner (z. B. `%AppData%\Minecraft Bedrock`)
    pub target: PathBuf,
    pub layout: Layout,
    /// Parkplatz für die Nutzerdaten während eine Instanz eingetauscht ist
    pub park: PathBuf,
    pub journal: PathBuf,
    /// Auffangordner für Unerwartetes (nie löschen)
    pub rescue: PathBuf,
}

/// Meldung, wenn das Spiel läuft.
pub const RUNNING_MSG: &str = "Minecraft Bedrock läuft gerade. Bitte schließe das Spiel zuerst.";

impl Swapper {
    pub fn load_journal(&self) -> Option<Journal> {
        let b = std::fs::read(&self.journal).ok()?;
        match serde_json::from_slice(&b) {
            Ok(j) => Some(j),
            Err(e) => {
                // Unlesbar sollte nie vorkommen (atomares Schreiben). Sicherheitshalber als „offen“ behandeln,
                // damit niemals getauscht wird, solange unklar ist, wem die Ordner gehören.
                tracing::error!("Bedrock-Journal {:?} unlesbar: {e}", self.journal);
                Some(Journal { instance_id: String::new(), phase: Phase::Active, home_slots: Vec::new(), inst_slots: Vec::new(), profile: PathBuf::new(), started_at: 0 })
            }
        }
    }

    /// Instanz, die gerade eingetauscht ist (bzw. deren Tausch offen ist).
    pub fn active_instance(&self) -> Option<String> {
        self.load_journal().map(|j| j.instance_id)
    }

    pub(super) fn save(&self, j: &Journal) -> AppResult<()> {
        crash_point()?;
        crate::util::write_json_atomic(&self.journal, j)
    }

    /// Instanz-Profil in den echten Ordner tauschen. Bei Fehlern wird sofort zurückgetauscht.
    pub fn swap_in(&self, instance_id: &str, profile: &Path, running: &dyn Fn() -> bool) -> AppResult<()> {
        if let Some(j) = self.load_journal() {
            return Err(AppError::Invalid(format!(
                "Ein früherer Profil-Tausch ({}) ist noch nicht abgeschlossen. Bitte erst „Daten zurücktauschen“ ausführen.",
                if j.instance_id.is_empty() { "unbekannt" } else { j.instance_id.as_str() }
            )));
        }
        if running() {
            return Err(AppError::Invalid(RUNNING_MSG.into()));
        }
        if !self.layout.slots(&self.park).is_empty() {
            return Err(AppError::msg(format!(
                "Im Parkordner {:?} liegen noch Bedrock-Daten, aber es ist kein Tausch offen. Bitte die Daten von Hand prüfen (siehe docs/BEDROCK.md).",
                self.park
            )));
        }
        check_same_volume(&self.target, &self.park)?;
        check_same_volume(&self.target, profile)?;
        let home = self.layout.slots(&self.target);
        let inst = self.layout.slots(profile);
        // Verknüpfte Ordner (Junction/Symlink, z. B. von anderen Tools) nie tauschen: Sicherung und Tausch
        // würden sonst nur die Verknüpfung erfassen
        for p in home.iter().map(|s| slot_path(&self.target, s)).chain(inst.iter().map(|s| slot_path(profile, s))) {
            if std::fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err(AppError::Invalid(format!("{p:?} ist eine Verknüpfung (Junction/Symlink). Eigene Profile funktionieren nur mit normalen Ordnern – nutze „Gemeinsames Profil“.")));
            }
        }
        let mut j = Journal {
            instance_id: instance_id.to_string(),
            phase: Phase::SwappingIn,
            home_slots: home.clone(),
            inst_slots: inst.clone(),
            profile: profile.to_path_buf(),
            started_at: crate::util::now_ms(),
        };
        self.save(&j)?;
        let r = (|| -> AppResult<()> {
            for s in &home {
                mv(&slot_path(&self.target, s), &slot_path(&self.park, s))?;
            }
            for s in &inst {
                let dest = slot_path(&self.target, s);
                if dest.exists() {
                    return Err(AppError::msg(format!("{dest:?} ist unerwartet belegt")));
                }
                mv(&slot_path(profile, s), &dest)?;
            }
            j.phase = Phase::Active;
            self.save(&j)
        })();
        if let Err(e) = r {
            if is_crash(&e) {
                return Err(e);
            }
            tracing::warn!("Bedrock-Tausch fehlgeschlagen ({e}) – tausche zurück");
            if let Err(e2) = self.swap_out(running) {
                tracing::error!("Zurücktauschen nach Fehler fehlgeschlagen: {e2} (wird beim nächsten Start wiederholt)");
            }
            return Err(e);
        }
        Ok(())
    }

    /// Zurücktauschen bzw. offenen Tausch abschließen. `Ok(None)`, wenn nichts offen war.
    /// Idempotent: kann nach einem Abbruch an beliebiger Stelle einfach erneut aufgerufen werden.
    pub fn swap_out(&self, running: &dyn Fn() -> bool) -> AppResult<Option<SwapReport>> {
        let Some(mut j) = self.load_journal() else { return Ok(None) };
        if j.instance_id.is_empty() || j.profile.as_os_str().is_empty() {
            return Err(AppError::msg(format!("Bedrock-Journal {:?} ist beschädigt – bitte von Hand prüfen (docs/BEDROCK.md).", self.journal)));
        }
        if running() {
            return Err(AppError::Invalid(RUNNING_MSG.into()));
        }
        if j.phase != Phase::SwappingOut {
            j.phase = Phase::SwappingOut;
            self.save(&j)?;
        }
        let mut report = SwapReport { instance_id: j.instance_id.clone(), rescued: Vec::new() };
        let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
        // 1. Alles im echten Ordner, was nicht nachweislich Nutzerdaten sind, gehört der Instanz
        for s in self.layout.slots(&self.target) {
            let home_in_place = j.home_slots.contains(&s) && !slot_path(&self.park, &s).exists();
            if home_in_place {
                continue;
            }
            let mut dest = slot_path(&j.profile, &s);
            if dest.exists() {
                if is_empty_dir(&dest) {
                    std::fs::remove_dir(&dest)?;
                } else {
                    dest = slot_path(&self.rescue.join(&stamp).join(&j.instance_id), &s);
                    report.rescued.push(dest.clone());
                }
            }
            mv(&slot_path(&self.target, &s), &dest)?;
        }
        // 2. Geparkte Nutzerdaten zurück
        for s in &j.home_slots {
            let parked = slot_path(&self.park, s);
            if !parked.exists() {
                continue;
            }
            let dest = slot_path(&self.target, s);
            if dest.exists() {
                // Nur möglich, wenn währenddessen etwas den Ordner neu angelegt hat (Spiel gestartet?)
                return Err(AppError::msg(format!("{dest:?} wurde während des Zurücktauschens neu angelegt. Bitte das Spiel schließen und erneut versuchen.")));
            }
            mv(&parked, &dest)?;
        }
        // 3. Unerwartete Reste im Parkplatz retten (sollte nie vorkommen)
        for s in self.layout.slots(&self.park) {
            let dest = slot_path(&self.rescue.join(&stamp).join("park"), &s);
            mv(&slot_path(&self.park, &s), &dest)?;
            report.rescued.push(dest);
        }
        remove_empty_dirs(&self.park);
        crash_point()?;
        std::fs::remove_file(&self.journal)?;
        if !report.rescued.is_empty() {
            tracing::warn!("Bedrock-Tausch: unerwartete Ordner gesichert unter {:?}", report.rescued);
        }
        Ok(Some(report))
    }
}
