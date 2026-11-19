//! Ist Bedrock installiert? Läuft es? Nur lesende Abfragen (Registry, Dateisystem, Prozessliste).
use crate::instance::BedrockChannel;
use serde::Serialize;

/// Installation eines Kanals.
#[derive(Debug, Clone, Serialize, Default)]
pub struct Install {
    pub installed: bool,
    /// Spielversion, soweit aus dem Paketnamen ablesbar (z. B. "1.21.120")
    pub version: Option<String>,
}

/// Paketversion `1.21.12001.0` -> Spielversion `1.21.120` (dritte Stelle = Patch * 100 + Build).
pub fn game_version(pkg: &str) -> Option<String> {
    let p: Vec<u64> = pkg.split('.').map(|x| x.parse().ok()).collect::<Option<_>>()?;
    if p.len() < 3 {
        return None;
    }
    Some(format!("{}.{}.{}", p[0], p[1], p[2] / 100))
}

/// Versionsteil aus einem Paketnamen `Microsoft.MinecraftUWP_1.21.12001.0_x64__8wekyb3d8bbwe`.
pub fn version_from_package(full_name: &str, family: &str) -> Option<String> {
    let prefix = family.split('_').next()?;
    let rest = full_name.strip_prefix(prefix)?.strip_prefix('_')?;
    let ver = rest.split('_').next()?;
    game_version(ver)
}

pub fn install(channel: BedrockChannel) -> Install {
    if super::simulated() {
        return Install {
            installed: std::env::var_os("VIBE_BEDROCK_SIM_MISSING").is_none(),
            version: Some("1.21.120".into()),
        };
    }
    #[cfg(windows)]
    {
        let family = super::package_family(channel);
        let prefix = format!("{}_", family.split('_').next().unwrap_or(family));
        let packages = win::subkeys(r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages");
        let mut best: Option<String> = None;
        for k in packages.iter().filter(|k| k.starts_with(&prefix) && k.ends_with("8wekyb3d8bbwe")) {
            if let Some(v) = version_from_package(k, family) {
                if best.as_ref().map_or(true, |b| cmp_version(&v, b).is_gt()) {
                    best = Some(v);
                }
            }
        }
        if best.is_some() {
            return Install { installed: true, version: best };
        }
        // GDK-Installation über die Xbox-App (Ordner auf einem lokalen Laufwerk)
        let names: &[&str] = match channel {
            BedrockChannel::Release => &["Minecraft for Windows", "7792D9CE-355A-493C-AFBD-768F4A77C3B0"],
            BedrockChannel::Preview => &["Minecraft Preview for Windows", "98BD2335-9B01-4E4C-BD05-CCC01614078B"],
        };
        for d in win::fixed_drives() {
            for n in names {
                let p = std::path::PathBuf::from(format!("{d}:\\XboxGames\\{n}\\Content"));
                if p.is_dir() {
                    return Install { installed: true, version: None };
                }
            }
        }
        Install::default()
    }
    #[cfg(not(windows))]
    {
        let _ = channel;
        Install::default()
    }
}

fn cmp_version(a: &str, b: &str) -> std::cmp::Ordering {
    let k = |s: &str| s.split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    k(a).cmp(&k(b))
}

/// Laufender Bedrock-Prozess.
#[derive(Debug, Clone)]
pub struct Proc {
    pub pid: u32,
    /// Aus dem Pfad geraten (Preview-Ordner); `None` = unbekannt
    pub channel: Option<BedrockChannel>,
}

/// Name der Spiel-Exe (UWP und GDK).
pub const EXE: &str = "Minecraft.Windows.exe";

/// Alle laufenden Bedrock-Prozesse (beide Kanäle).
pub fn processes() -> Vec<Proc> {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.processes()
        .iter()
        .filter(|(_, p)| p.name().to_string_lossy().eq_ignore_ascii_case(EXE))
        .map(|(pid, p)| {
            let path = p.exe().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            let channel = if path.is_empty() {
                None
            } else if path.contains("preview") || path.contains("windowsbeta") || path.contains("98bd2335") {
                Some(BedrockChannel::Preview)
            } else {
                Some(BedrockChannel::Release)
            };
            Proc { pid: pid.as_u32(), channel }
        })
        .collect()
}

/// Läuft irgendein Bedrock? (Vor jedem Tausch: im Zweifel blockieren.)
pub fn any_running() -> bool {
    !processes().is_empty()
}

/// Prozess des Kanals (oder unbekannten Kanals).
pub fn running_pid(channel: BedrockChannel) -> Option<u32> {
    let ps = processes();
    ps.iter().find(|p| p.channel == Some(channel)).or_else(|| ps.iter().find(|p| p.channel.is_none())).map(|p| p.pid)
}

#[cfg(windows)]
mod win {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    use windows_sys::Win32::System::Registry::{RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Namen der Unterschlüssel unter HKCU\<path> (leer bei Fehler).
    pub fn subkeys(path: &str) -> Vec<String> {
        let mut out = Vec::new();
        let p = wide(path);
        let mut key: HKEY = std::ptr::null_mut();
        // SAFETY: gültige, nullterminierte Zeichenkette; `key` wird nur bei Erfolg benutzt und geschlossen.
        unsafe {
            if RegOpenKeyExW(HKEY_CURRENT_USER, p.as_ptr(), 0, KEY_READ, &mut key) != ERROR_SUCCESS {
                return out;
            }
            let mut i = 0u32;
            loop {
                let mut buf = [0u16; 512];
                let mut len = buf.len() as u32;
                let r = RegEnumKeyExW(key, i, buf.as_mut_ptr(), &mut len, std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut());
                if r != ERROR_SUCCESS {
                    break;
                }
                out.push(String::from_utf16_lossy(&buf[..len as usize]));
                i += 1;
                if i > 100_000 {
                    break;
                }
            }
            RegCloseKey(key);
        }
        out
    }

    /// Buchstaben lokaler Festplatten (keine Netz-/Wechsellaufwerke – die können beim Prüfen hängen).
    pub fn fixed_drives() -> Vec<char> {
        let mut out = Vec::new();
        // SAFETY: reine Abfragen ohne Zeiger außer der nullterminierten Zeichenkette.
        let mask = unsafe { GetLogicalDrives() };
        for i in 0..26u32 {
            if mask & (1 << i) == 0 {
                continue;
            }
            let letter = (b'A' + i as u8) as char;
            let root = wide(&format!("{letter}:\\"));
            if unsafe { GetDriveTypeW(root.as_ptr()) } == 3 {
                out.push(letter);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn versions() {
        assert_eq!(game_version("1.21.12001.0").as_deref(), Some("1.21.120"));
        assert_eq!(game_version("1.20.8101.0").as_deref(), Some("1.20.81"));
        assert_eq!(game_version("x"), None);
        assert_eq!(
            version_from_package("Microsoft.MinecraftUWP_1.21.12001.0_x64__8wekyb3d8bbwe", "Microsoft.MinecraftUWP_8wekyb3d8bbwe").as_deref(),
            Some("1.21.120")
        );
        assert_eq!(version_from_package("Microsoft.MinecraftWindowsBeta_1.21.13020.0_x64__8wekyb3d8bbwe", "Microsoft.MinecraftUWP_8wekyb3d8bbwe"), None);
        assert!(cmp_version("1.21.120", "1.21.90").is_gt());
    }
}
