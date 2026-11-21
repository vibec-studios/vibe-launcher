//! App-Icon frei wählbar (`settings.appearance`): Motiv `app_icon` = "seal" | "penguin" | "custom",
//! Kachelfarbe `app_icon_color`, eigenes Bild `app_icon_image` (nach `<daten>/app-icon/` kopiert).
//!
//! Das Icon wird zur Laufzeit gezeichnet: eckige Kachel (leicht gerundet, helle Ober- und dunkle Unterkante)
//! mit der Pixel-Robbe bzw. dem Pixel-Pinguin (pixelgenau skaliert) oder dem eigenen Bild (füllt die Kachel).
//! - Fenster-Icon (Taskleisten-Knopf des laufenden Fensters) wird sofort gesetzt.
//! - Windows: die eigenen Verknüpfungen des Launchers (Desktop, Startmenü, an die Taskleiste angeheftet), also
//!   `.lnk` mit Ziel = diese EXE und **ohne** Argumente (Instanz-Verknüpfungen bleiben unberührt), bekommen ein
//!   passendes `.ico`. Im Hintergrund und nur, wenn sich das Icon gegenüber dem letzten Mal geändert hat.
//!
//! Das in die EXE eingebettete Icon (Installer, Explorer) bleibt die Robbe auf Standardfarbe.
use crate::error::{AppError, AppResult};
use crate::settings::Appearance;
use image::{imageops::FilterType, Rgba, RgbaImage};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

mod render;

pub use render::*;

pub const MOTIFS: &[&str] = &["seal", "penguin", "custom"];
pub const DEFAULT_COLOR: &str = "#8b6cff";

const SEAL: [&str; 7] = [".AAAAA.", "ABBBBBA", "BCBBBCB", "BBBBBBB", "DEEFEED", ".EEEEE.", "..BBB.."];
const SEAL_PAL: &[(char, u32)] = &[('A', 0x7d8894), ('B', 0x8f9aa6), ('C', 0x141418), ('D', 0xff9db8), ('E', 0xe8ecf0), ('F', 0x2a2a30)];
const PENGUIN: [&str; 7] = [".AAAAA.", "ABBBBBA", "BEWEWEB", "BEEOEEB", "DEEEEED", ".EEEEE.", "..O.O.."];
const PENGUIN_PAL: &[(char, u32)] = &[('A', 0x1c212c), ('B', 0x2c3342), ('W', 0x141418), ('E', 0xe8ecf0), ('O', 0xffa630), ('D', 0xff9db8)];

/// Gewählte Icon-Einstellungen (aus den Settings, bereits bereinigt).
#[derive(Debug, Clone, PartialEq)]
pub struct IconSpec {
    pub motif: String,
    pub color: [u8; 3],
    pub image: Option<PathBuf>,
}

impl IconSpec {
    pub fn from_appearance(a: &Appearance) -> Self {
        Self::new(&a.app_icon, &a.app_icon_color, a.app_icon_image.as_deref())
    }

    pub fn new(motif: &str, color: &str, image: Option<&str>) -> Self {
        let motif = if MOTIFS.contains(&motif) { motif } else { "seal" }.to_string();
        let color = parse_hex(color).or_else(|| parse_hex(DEFAULT_COLOR)).unwrap_or([0x8b, 0x6c, 0xff]);
        let image = image.filter(|p| !p.is_empty()).map(PathBuf::from);
        IconSpec { motif, color, image }
    }

    fn is_default(&self) -> bool {
        self.motif == "seal" && self.has_default_color()
    }

    pub fn has_default_color(&self) -> bool {
        Some(self.color) == parse_hex(DEFAULT_COLOR)
    }

    /// Schlüssel für „hat sich geändert?“ (inkl. Änderungszeit des eigenen Bildes).
    fn key(&self) -> String {
        let img = match (&self.motif[..], &self.image) {
            ("custom", Some(p)) => {
                let m = std::fs::metadata(p).and_then(|m| m.modified()).ok();
                format!("{}@{:?}", p.display(), m)
            }
            _ => String::new(),
        };
        format!("{}|{:02x}{:02x}{:02x}|{img}", self.motif, self.color[0], self.color[1], self.color[2])
    }
}

/// Eigenes Bild nach `<daten>/app-icon/` kopieren (PNG/JPG, max. 10 MB). Gibt den neuen Pfad zurück.
/// `prefix` trennt die Bilder: "custom" (App-Icon) bzw. "discord" (Discord-Status).
pub fn import_image(root: &Path, src: &Path, prefix: &str) -> AppResult<PathBuf> {
    let ext = src.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if !["png", "jpg", "jpeg"].contains(&ext.as_str()) {
        return Err(AppError::Invalid("Bitte ein PNG- oder JPG-Bild wählen".into()));
    }
    let meta = std::fs::metadata(src)?;
    if !meta.is_file() || meta.len() > 10 * 1024 * 1024 {
        return Err(AppError::Invalid("Das Bild ist zu groß (max. 10 MB)".into()));
    }
    image::open(src).map_err(|_| AppError::Invalid("Das Bild konnte nicht gelesen werden".into()))?;
    let dir = root.join("app-icon");
    std::fs::create_dir_all(&dir)?;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with(&format!("{prefix}-")) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let target = dir.join(format!("{prefix}-{}.{ext}", crate::util::now_ms()));
    std::fs::copy(src, &target)?;
    Ok(target)
}

/// Icon anwenden (Fenster sofort, Verknüpfungen im Hintergrund).
pub fn apply(app: &AppHandle, a: &Appearance) {
    let spec = IconSpec::from_appearance(a);
    let img = render(&spec, 256);
    let (w, h) = img.dimensions();
    let icon = tauri::image::Image::new_owned(img.into_raw(), w, h);
    for win in app.webview_windows().values() {
        if let Err(e) = win.set_icon(icon.clone()) {
            tracing::warn!("Fenster-Icon nicht setzbar: {e}");
        }
        // Tauri setzt unter Windows nur ICON_SMALL (Titelleiste); die Taskleiste zeigt ICON_BIG
        #[cfg(windows)]
        match win.hwnd() {
            Ok(hwnd) => win32::set_window_icons(hwnd.0, &spec),
            Err(e) => tracing::warn!("Fenster-Handle nicht verfügbar: {e}"),
        }
    }
    #[cfg(windows)]
    {
        // Nur in echten Builds und nicht in Testläufen mit eigenem Datenordner
        if cfg!(debug_assertions) || std::env::var_os("VIBE_LAUNCHER_HOME").is_some() || crate::paths::portable::active() {
            return;
        }
        if let Some(state) = app.try_state::<crate::state::AppState>() {
            let dir = state.paths.root.join("app-icon");
            std::thread::spawn(move || {
                if let Err(e) = update_shortcuts(&dir, &spec) {
                    tracing::warn!("Verknüpfungs-Icons nicht aktualisiert: {e}");
                }
            });
        }
    }
}

/// Win32: großes und kleines Fenster-Icon in der passenden Pixelgröße (scharf, DPI-genau) setzen.
#[cfg(windows)]
mod win32 {
    use super::{render, IconSpec};
    use windows_sys::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateIcon, SendMessageW, HICON, ICON_BIG, ICON_SMALL, SM_CXICON, SM_CXSMICON, WM_SETICON,
    };

    fn hicon(spec: &IconSpec, size: u32) -> HICON {
        let img = render(spec, size);
        // CreateIcon erwartet BGRA (32 bpp) plus AND-Maske (bei Alpha-Bitmaps egal, aber nötig)
        let mut bgra = img.into_raw();
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        let mask = vec![0u8; (size * size / 8) as usize];
        unsafe { CreateIcon(std::ptr::null_mut(), size as i32, size as i32, 1, 32, mask.as_ptr(), bgra.as_ptr()) }
    }

    pub fn set_window_icons(hwnd: *mut core::ffi::c_void, spec: &IconSpec) {
        unsafe {
            let dpi = GetDpiForWindow(hwnd).max(96);
            let big = GetSystemMetricsForDpi(SM_CXICON, dpi).clamp(16, 256) as u32;
            let small = GetSystemMetricsForDpi(SM_CXSMICON, dpi).clamp(16, 256) as u32;
            for (kind, size) in [(ICON_BIG, big), (ICON_SMALL, small)] {
                let h = hicon(spec, size);
                if h.is_null() {
                    tracing::warn!("App-Icon ({size} px) konnte nicht erzeugt werden");
                    continue;
                }
                // Das vorherige Icon nicht freigeben: das erste gehört Tauri/tao (würde dort doppelt freigegeben)
                SendMessageW(hwnd, WM_SETICON, kind as usize, h as isize);
            }
        }
    }
}

#[cfg(windows)]
fn update_shortcuts(dir: &Path, spec: &IconSpec) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    let marker = dir.join("applied");
    let last = std::fs::read_to_string(&marker).unwrap_or_default();
    let key = spec.key();
    // Unverändert, oder erster Start mit dem Standard-Icon (Verknüpfungen zeigen ohnehin das EXE-Icon)
    if last.trim() == key || (last.is_empty() && spec.is_default()) {
        return Ok(());
    }
    std::fs::create_dir_all(dir)?;
    let exe = std::env::current_exe()?;
    let icon = if spec.is_default() {
        format!("{},0", exe.display())
    } else {
        // Neuer Dateiname je Änderung, damit Windows' Icon-Cache das neue Bild zeigt
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                if e.file_name().to_string_lossy().starts_with("icon-") {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        let ico = dir.join(format!("icon-{}.ico", crate::util::now_ms()));
        std::fs::write(&ico, ico_bytes(spec)?)?;
        format!("{},0", ico.display())
    };
    let script = r#"$exe=$env:VL_EXE;$icon=$env:VL_ICON;$sh=New-Object -ComObject WScript.Shell;
$dirs=@([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonDesktopDirectory'),[Environment]::GetFolderPath('CommonPrograms'),(Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'));
foreach($d in $dirs){ if($d -and (Test-Path -LiteralPath $d)){ Get-ChildItem -LiteralPath $d -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
  try { $s=$sh.CreateShortcut($_.FullName); if(($s.TargetPath -ieq $exe) -and [string]::IsNullOrWhiteSpace($s.Arguments)){ $s.IconLocation=$icon; $s.Save() } } catch {} } } }
try { Start-Process -FilePath 'ie4uinit.exe' -ArgumentList '-show' -WindowStyle Hidden } catch {}"#;
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .env("VL_EXE", &exe)
        .env("VL_ICON", &icon)
        .creation_flags(crate::minecraft::java::CREATE_NO_WINDOW)
        .output()?;
    if !out.status.success() {
        return Err(AppError::msg(String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    std::fs::write(&marker, key)?;
    Ok(())
}

#[cfg(test)]
mod tests;
