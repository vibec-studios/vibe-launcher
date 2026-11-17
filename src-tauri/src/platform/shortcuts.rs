//! Desktop-/Startmenü-Verknüpfungen je Instanz: starten `vibe-launcher --launch <id>`.
//! Windows: .lnk über WScript.Shell (Werte per Umgebungsvariablen – keine Skript-Injektion),
//! Icon als .ico aus dem Instanz-Icon. Linux: .desktop-Datei. macOS: nicht unterstützt.
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// Dateiname aus dem Instanznamen (ohne verbotene Zeichen).
pub fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let s = s.trim().trim_end_matches('.').trim().to_string();
    if s.is_empty() {
        "Minecraft".into()
    } else {
        s.chars().take(80).collect()
    }
}

/// Instanz-Icon (PNG/JPG) in eine .ico-Datei wandeln (256 px). None = kein/unlesbares Icon.
pub fn make_ico(icon: &Path, out: &Path) -> Option<PathBuf> {
    let img = image::open(icon).ok()?;
    let img = img.resize(256, 256, image::imageops::FilterType::Nearest);
    if let Some(d) = out.parent() {
        std::fs::create_dir_all(d).ok()?;
    }
    img.save_with_format(out, image::ImageFormat::Ico).ok()?;
    Some(out.to_path_buf())
}

pub fn target_dir(location: &str) -> AppResult<PathBuf> {
    match location {
        "desktop" => {
            dirs::desktop_dir().ok_or_else(|| AppError::msg("Desktop-Ordner nicht gefunden"))
        }
        "start_menu" => {
            #[cfg(windows)]
            {
                dirs::data_dir()
                    .map(|d| d.join(r"Microsoft\Windows\Start Menu\Programs\Vibe Launcher"))
                    .ok_or_else(|| AppError::msg("Startmenü-Ordner nicht gefunden"))
            }
            #[cfg(not(windows))]
            {
                dirs::data_dir()
                    .map(|d| d.join("applications"))
                    .ok_or_else(|| AppError::msg("Anwendungsordner nicht gefunden"))
            }
        }
        _ => Err(AppError::Invalid("Unbekannter Ort".into())),
    }
}

/// Verknüpfung anlegen; gibt den Pfad zurück.
#[allow(unused_variables)]
pub fn create(
    dir: &Path,
    name: &str,
    instance_id: &str,
    icon: Option<&Path>,
) -> AppResult<PathBuf> {
    let exe = std::env::current_exe()?;
    std::fs::create_dir_all(dir)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let link = dir.join(format!("{}.lnk", safe_name(name)));
        let script = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:VL_LINK);\
                      $s.TargetPath=$env:VL_EXE;$s.Arguments=$env:VL_ARGS;$s.WorkingDirectory=$env:VL_CWD;\
                      if($env:VL_ICON){$s.IconLocation=$env:VL_ICON};$s.Description=$env:VL_DESC;$s.Save()";
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ])
            .env("VL_LINK", &link)
            .env("VL_EXE", &exe)
            .env("VL_ARGS", format!("--launch {instance_id}"))
            .env("VL_CWD", exe.parent().unwrap_or(Path::new(".")))
            .env(
                "VL_ICON",
                icon.map(|p| p.as_os_str().to_owned()).unwrap_or_default(),
            )
            .env("VL_DESC", format!("{name} – Vibe Launcher"))
            .creation_flags(crate::minecraft::java::CREATE_NO_WINDOW)
            .output()?;
        if !out.status.success() || !link.exists() {
            return Err(AppError::msg(format!(
                "Verknüpfung konnte nicht erstellt werden: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        Ok(link)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        use std::os::unix::fs::PermissionsExt;
        let file = dir.join(format!("vibe-launcher-{instance_id}.desktop"));
        let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
        let mut text = format!(
            "[Desktop Entry]\nType=Application\nName={}\nComment=Vibe Launcher\nExec=\"{}\" --launch {}\nTerminal=false\nCategories=Game;\n",
            name.replace('\n', " "),
            esc(&exe.to_string_lossy()),
            instance_id
        );
        if let Some(i) = icon {
            text.push_str(&format!("Icon={}\n", i.display()));
        }
        std::fs::write(&file, text)?;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755));
        Ok(file)
    }
    #[cfg(target_os = "macos")]
    {
        Err(AppError::msg(
            "Verknüpfungen werden auf macOS noch nicht unterstützt",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(safe_name("Survival: Teil 2/3?"), "Survival  Teil 2 3");
        assert_eq!(safe_name("..."), "Minecraft");
        assert_eq!(safe_name("NeoForge Abenteuer"), "NeoForge Abenteuer");
    }

    #[test]
    fn ico_from_png() {
        let dir = std::env::temp_dir().join(format!("vl-ico-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("i.png");
        image::RgbaImage::from_pixel(16, 16, image::Rgba([10, 200, 150, 255]))
            .save(&png)
            .unwrap();
        let ico = make_ico(&png, &dir.join("x.ico")).unwrap();
        let b = std::fs::read(ico).unwrap();
        assert_eq!(&b[..4], &[0, 0, 1, 0]); // ICO-Kopf
        assert!(make_ico(&dir.join("fehlt.png"), &dir.join("y.ico")).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
