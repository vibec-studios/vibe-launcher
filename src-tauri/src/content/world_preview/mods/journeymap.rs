use super::{Canvas, REGION};
use image::{imageops, DynamicImage, ImageDecoder};
use std::io::{self, Cursor};

const MAX_SIDE: u32 = 2048;

pub fn decode(bytes: &[u8], canvas: &mut Canvas) -> io::Result<bool> {
    let invalid = || io::Error::from(io::ErrorKind::InvalidData);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(64 * 1024 * 1024);
    let decoder = image::codecs::png::PngDecoder::with_limits(Cursor::new(bytes), limits)
        .map_err(|_| invalid())?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 || width != height {
        return Err(invalid());
    }
    let mut image = DynamicImage::from_decoder(decoder)
        .map_err(|_| invalid())?
        .into_rgba8();
    if width != REGION {
        image = imageops::resize(&image, REGION, REGION, imageops::FilterType::Nearest);
    }
    let painted = image.pixels().any(|pixel| pixel.0[3] > 0);
    canvas.image = image;
    canvas.painted = painted;
    Ok(painted)
}
