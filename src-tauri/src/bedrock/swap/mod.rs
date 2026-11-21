//! Getrennte Profile durch Tauschen der `com.mojang`-Ordner („Slots“).
//!
//! Vor dem Start einer Instanz mit eigenem Profil:
//! 1. Journal `swap-<kanal>.json` schreiben (Phase `swapping_in`, Liste der Slots des Nutzers)
//! 2. jeden echten Slot per `rename` in den Parkplatz `park/<kanal>/` schieben
//! 3. jeden Slot der Instanz per `rename` in den echten Ordner schieben
//! 4. Phase `active`
//!
//! Nach dem Spiel (und bei jeder Wiederaufnahme nach Absturz/Stromausfall) läuft [`Swapper::swap_out`]:
//! alles im echten Ordner, was nicht nachweislich Nutzerdaten sind, geht zurück ins Profil, danach kommen
//! die geparkten Nutzerdaten zurück, zuletzt wird das Journal gelöscht. Jeder Schritt ist ein einzelnes
//! `rename` auf demselben Laufwerk (atomar); aus Journal + Dateisystem ist zu jedem Zeitpunkt eindeutig,
//! wem ein Ordner gehört. Es wird nie etwas gelöscht oder überschrieben: Unerwartetes landet in `rescue/`.
//! Nie während das Spiel läuft (`running`-Prüfung vor jedem Tausch).
use super::{slot_path, Layout};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

mod swapper;
mod fsutil;
mod copy;
mod crashsim;

pub use swapper::*;
pub use fsutil::*;
pub use copy::*;
use crashsim::*;

#[cfg(test)]
mod tests;
