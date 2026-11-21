use super::*;

pub(super) fn parse_hex(s: &str) -> Option<[u8; 3]> {
    let h = s.trim().strip_prefix('#')?;
    if h.len() != 6 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    Some([(v >> 16) as u8, (v >> 8) as u8, v as u8])
}

pub(super) fn mix(c: [u8; 3], with: [u8; 3], t: f32) -> [u8; 3] {
    let m = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t).round() as u8;
    [m(c[0], with[0]), m(c[1], with[1]), m(c[2], with[2])]
}

/// Anteil eines Pixels innerhalb eines gerundeten Rechtecks (4×4 Supersampling).
pub(super) fn coverage(x: u32, y: u32, w: f32, h: f32, r: f32) -> f32 {
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

pub(super) fn glyph(rows: &[&str; 7], pal: &[(char, u32)]) -> RgbaImage {
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

pub(super) fn blend(dst: &mut Rgba<u8>, src: Rgba<u8>, alpha: f32) {
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
