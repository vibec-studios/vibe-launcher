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
        self.motif == "seal" && Some(self.color) == parse_hex(DEFAULT_COLOR)
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

fn parse_hex(s: &str) -> Option<[u8; 3]> {
    let h = s.trim().strip_prefix('#')?;
    if h.len() != 6 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    Some([(v >> 16) as u8, (v >> 8) as u8, v as u8])
}

fn mix(c: [u8; 3], with: [u8; 3], t: f32) -> [u8; 3] {
    let m = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t).round() as u8;
    [m(c[0], with[0]), m(c[1], with[1]), m(c[2], with[2])]
}

/// Anteil eines Pixels innerhalb eines gerundeten Rechtecks (4×4 Supersampling).
fn coverage(x: u32, y: u32, w: f32, h: f32, r: f32) -> f32 {
    let mut n = 0;
    for sy in 0..4 {
        for sx in 0..4 {
            let px = x as f32 + (sx as f32 + 0.5) / 4.0;
            let py = y as f32 + (sy as f32 + 0.5) / 4.0;
            if px > w || py > h {
                continue;
            }
            let dx = (r - px).max(px - (w - r)).max(0.0);
            let dy = (r - py).max(py - (h - r)).max(0.0);
            if dx * dx + dy * dy <= r * r {
                n += 1;
            }
        }
    }
    n as f32 / 16.0
}

fn glyph(rows: &[&str; 7], pal: &[(char, u32)]) -> RgbaImage {
    let mut g = RgbaImage::new(7, 7);
    for (y, row) in rows.iter().enumerate() {
        for (x, ch) in row.chars().enumerate() {
            if let Some((_, c)) = pal.iter().find(|(k, _)| *k == ch) {
                g.put_pixel(x as u32, y as u32, Rgba([(c >> 16) as u8, (c >> 8) as u8, *c as u8, 255]));
            }
        }
    }
    g
}

fn blend(dst: &mut Rgba<u8>, src: Rgba<u8>, alpha: f32) {
    let a = (src[3] as f32 / 255.0) * alpha;
    if a <= 0.0 {
        return;
    }
    let da = dst[3] as f32 / 255.0;
    let oa = a + da * (1.0 - a);
    for i in 0..3 {
        let v = (src[i] as f32 * a + dst[i] as f32 * da * (1.0 - a)) / oa.max(1e-6);
        dst[i] = v.round().clamp(0.0, 255.0) as u8;
    }
    dst[3] = (oa * 255.0).round() as u8;
}

/// Icon in Größe `s` zeichnen.
pub fn render(spec: &IconSpec, s: u32) -> RgbaImage {
    let sf = s as f32;
    let r = (sf * 0.085).max(1.0);
    let edge = (sf / 16.0).max(1.0);
    let base = spec.color;
    let dark = mix(base, [0, 0, 0], 0.22);
    let light = mix(base, [255, 255, 255], 0.22);
    let mut out = RgbaImage::new(s, s);
    for y in 0..s {
        for x in 0..s {
            let cov = coverage(x, y, sf, sf, r);
            if cov <= 0.0 {
                continue;
            }
            let yc = y as f32 + 0.5;
            let c = if yc > sf - edge {
                dark
            } else if yc < edge {
                light
            } else {
                base
            };
            out.put_pixel(x, y, Rgba([c[0], c[1], c[2], (cov * 255.0).round() as u8]));
        }
    }
    let custom = (spec.motif == "custom").then(|| spec.image.as_deref().and_then(|p| image::open(p).ok())).flatten();
    if let Some(img) = custom {
        // Eigenes Bild füllt die Kachel (zugeschnitten), Ecken folgen der Kachel; kleine Pixelbilder bleiben scharf
        let filter = if img.width().min(img.height()) <= 64 { FilterType::Nearest } else { FilterType::Lanczos3 };
        let fill = img.resize_to_fill(s, s, filter).to_rgba8();
        for (x, y, p) in fill.enumerate_pixels() {
            let cov = coverage(x, y, sf, sf, r);
            if cov > 0.0 {
                let mut d = *out.get_pixel(x, y);
                blend(&mut d, *p, 1.0);
                d[3] = (cov * 255.0).round() as u8;
                out.put_pixel(x, y, d);
            }
        }
        return out;
    }
    let g = if spec.motif == "penguin" { glyph(&PENGUIN, PENGUIN_PAL) } else { glyph(&SEAL, SEAL_PAL) };
    let k = ((sf * 0.68 / 7.0).round() as u32).max(1);
    let big = image::imageops::resize(&g, 7 * k, 7 * k, FilterType::Nearest);
    let lift = if s >= 48 { (s / 64).max(1) } else { 0 };
    let ox = (s - big.width()) / 2;
    let oy = ((s - big.height()) / 2).saturating_sub(lift);
    for (x, y, p) in big.enumerate_pixels() {
        if p[3] > 0 {
            let d = out.get_pixel_mut(ox + x, oy + y);
            blend(d, *p, 1.0);
        }
    }
    out
}

/// PNG-Bytes (für die Vorschau in den Einstellungen).
pub fn png_bytes(spec: &IconSpec, s: u32) -> AppResult<Vec<u8>> {
    let mut buf = std::io::Cursor::new(Vec::new());
    render(spec, s).write_to(&mut buf, image::ImageFormat::Png).map_err(|e| AppError::msg(e.to_string()))?;
    Ok(buf.into_inner())
}

/// .ico mit allen üblichen Größen.
pub fn ico_bytes(spec: &IconSpec) -> AppResult<Vec<u8>> {
    use image::codecs::ico::{IcoEncoder, IcoFrame};
    let mut frames = Vec::new();
    for s in [16u32, 24, 32, 48, 64, 128, 256] {
        let img = render(spec, s);
        frames.push(IcoFrame::as_png(img.as_raw(), s, s, image::ExtendedColorType::Rgba8).map_err(|e| AppError::msg(e.to_string()))?);
    }
    let mut buf = Vec::new();
    IcoEncoder::new(&mut buf).encode_images(&frames).map_err(|e| AppError::msg(e.to_string()))?;
    Ok(buf)
}

/// Eigenes Bild nach `<daten>/app-icon/` kopieren (PNG/JPG, max. 10 MB). Gibt den neuen Pfad zurück.
pub fn import_image(root: &Path, src: &Path) -> AppResult<PathBuf> {
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
            if e.file_name().to_string_lossy().starts_with("custom-") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let target = dir.join(format!("custom-{}.{ext}", crate::util::now_ms()));
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
    }
    #[cfg(windows)]
    {
        // Nur in echten Builds und nicht in Testläufen mit eigenem Datenordner
        if cfg!(debug_assertions) || std::env::var_os("VIBE_LAUNCHER_HOME").is_some() {
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
mod tests {
    use super::*;

    #[test]
    fn renders_all_sizes() {
        for m in ["seal", "penguin", "custom"] {
            let spec = IconSpec::new(m, "#22aa66", None);
            for s in [16, 32, 256] {
                let img = render(&spec, s);
                assert_eq!(img.dimensions(), (s, s));
                // Mitte ist deckend, Ecke (gerundet) transparent
                assert_eq!(img.get_pixel(s / 2, s / 2)[3], 255);
            }
            assert_eq!(render(&spec, 256).get_pixel(0, 0)[3], 0);
        }
        // Kachelfarbe kommt an
        let p = *render(&IconSpec::new("seal", "#22aa66", None), 64).get_pixel(4, 20);
        assert_eq!((p[0], p[1], p[2]), (0x22, 0xaa, 0x66));
        assert!(ico_bytes(&IconSpec::new("penguin", "#000000", None)).unwrap().len() > 1000);
    }

    #[test]
    fn spec_sanitizes() {
        let s = IconSpec::new("quatsch", "rot", Some(""));
        assert_eq!(s.motif, "seal");
        assert_eq!(s.color, [0x8b, 0x6c, 0xff]);
        assert!(s.image.is_none());
        assert!(s.is_default());
        assert!(!IconSpec::new("penguin", DEFAULT_COLOR, None).is_default());
    }

    #[test]
    fn custom_image() {
        let dir = std::env::temp_dir().join(format!("vl-appicon-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("me.png");
        RgbaImage::from_pixel(8, 8, Rgba([200, 10, 10, 255])).save(&src).unwrap();
        let stored = import_image(&dir, &src).unwrap();
        let spec = IconSpec::new("custom", DEFAULT_COLOR, stored.to_str());
        let p = *render(&spec, 64).get_pixel(32, 32);
        assert_eq!((p[0], p[1], p[2]), (200, 10, 10));
        assert!(import_image(&dir, &dir.join("nope.txt")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
