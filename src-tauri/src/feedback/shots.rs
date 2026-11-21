use super::*;

pub(super) fn hold(name: String, mime: &str, bytes: Vec<u8>, img: &image::DynamicImage) -> AppResult<ImageInfo> {
    let thumb = thumbnail(img)?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let info = ImageInfo { id: id.clone(), name: name.clone(), mime: mime.to_string(), bytes: bytes.len() as u64, width: img.width(), height: img.height(), thumb };
    let mut h = held().lock();
    // Nicht unbegrenzt sammeln: älteste raus
    if h.len() >= 12 {
        if let Some(k) = h.keys().next().cloned() {
            h.remove(&k);
        }
    }
    h.insert(id, Held { name, mime: mime.to_string(), bytes });
    Ok(info)
}

pub(super) fn thumbnail(img: &image::DynamicImage) -> AppResult<String> {
    use base64::Engine;
    let t = img.thumbnail(480, 480).to_rgb8();
    let mut out = std::io::Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
        .encode_image(&t)
        .map_err(|e| AppError::msg(format!("Vorschaubild: {e}")))?;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())))
}

/// Bild für den Versand kodieren: PNG, bei Überschreitung der Grenze JPEG und ggf. verkleinern.
pub(super) fn encode_shot(img: &image::RgbaImage) -> AppResult<(Vec<u8>, &'static str)> {
    let mut img = image::DynamicImage::ImageRgba8(img.clone());
    if img.width() > 2560 {
        img = img.resize(2560, 2560 * img.height() / img.width().max(1), image::imageops::FilterType::Triangle);
    }
    let mut png = std::io::Cursor::new(Vec::new());
    img.write_to(&mut png, image::ImageFormat::Png).map_err(|e| AppError::msg(format!("Screenshot: {e}")))?;
    if png.get_ref().len() <= SHOT_LIMIT {
        return Ok((png.into_inner(), "image/png"));
    }
    for (scale, q) in [(1.0f32, 85u8), (0.75, 80), (0.5, 75)] {
        let w = (img.width() as f32 * scale) as u32;
        let h = (img.height() as f32 * scale) as u32;
        let rgb = img.resize(w.max(1), h.max(1), image::imageops::FilterType::Triangle).to_rgb8();
        let mut out = std::io::Cursor::new(Vec::new());
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, q).encode_image(&rgb).map_err(|e| AppError::msg(format!("Screenshot: {e}")))?;
        if out.get_ref().len() <= SHOT_LIMIT {
            return Ok((out.into_inner(), "image/jpeg"));
        }
    }
    Err(AppError::Invalid("Der Screenshot ist zu groß.".into()))
}

/// Screenshot des Launcher-Fensters aufnehmen und im Speicher halten.
pub fn capture_window(app: &tauri::AppHandle) -> AppResult<ImageInfo> {
    let img = capture::capture_main(app)?;
    let (bytes, mime) = encode_shot(&img)?;
    let name = if mime == "image/png" { "launcher.png" } else { "launcher.jpg" };
    hold(name.to_string(), mime, bytes, &image::DynamicImage::ImageRgba8(img))
}

/// Bilddatei prüfen (Inhalt, nicht Endung) und im Speicher halten.
pub fn hold_file(path: &Path) -> AppResult<ImageInfo> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "screenshot.png".into());
    let f = std::fs::File::open(path).map_err(|_| AppError::NotFound(name.clone()))?;
    let mut bytes = Vec::new();
    f.take(SHOT_LIMIT as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > SHOT_LIMIT {
        return Err(AppError::Invalid(format!("„{name}“ ist größer als 5 MB.")));
    }
    let mime = sniff_image(&bytes).ok_or_else(|| AppError::Invalid(format!("„{name}“ ist kein PNG- oder JPEG-Bild.")))?;
    let img = image::load_from_memory(&bytes).map_err(|_| AppError::Invalid(format!("„{name}“ lässt sich nicht öffnen.")))?;
    hold(sanitize_name(&name, mime), mime, bytes, &img)
}

pub fn sniff_image(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else {
        None
    }
}

/// Dateiname ohne Pfad und persönliche Teile: nur einfache Zeichen, Endung passend zum Inhalt.
pub(super) fn sanitize_name(name: &str, mime: &str) -> String {
    let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let clean: String = stem.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).take(60).collect();
    let ext = if mime == "image/png" { "png" } else { "jpg" };
    if clean.is_empty() {
        format!("screenshot.{ext}")
    } else {
        format!("{clean}.{ext}")
    }
}
