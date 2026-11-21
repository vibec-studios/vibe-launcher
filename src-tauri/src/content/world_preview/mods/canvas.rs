use super::*;

pub struct Canvas {
    pub(super) image: RgbaImage,
    pub(super) heights: Vec<Option<i32>>,
    pub(super) painted: bool,
}

impl Canvas {
    pub(super) fn new() -> Self {
        Self {
            image: RgbaImage::new(REGION, REGION),
            heights: Vec::new(),
            painted: false,
        }
    }

    pub(super) fn put(&mut self, x: u32, z: u32, color: Color, height: i32) {
        if x >= REGION || z >= REGION {
            return;
        }
        if self.heights.is_empty() {
            self.heights = vec![None; (REGION * REGION) as usize];
        }
        self.image
            .put_pixel(x, z, Rgba([color[0], color[1], color[2], 255]));
        self.heights[(z * REGION + x) as usize] = Some(height);
        self.painted = true;
    }

    pub(super) fn shade(&mut self) {
        if self.heights.is_empty() {
            return;
        }
        let heights = &self.heights;
        let index = |x: u32, z: u32| (z * REGION + x) as usize;
        for (x, z, pixel) in self.image.enumerate_pixels_mut() {
            let Some(y) = heights[index(x, z)] else {
                continue;
            };
            let north = heights[index(x, z.saturating_sub(1))].unwrap_or(y);
            let west = heights[index(x.saturating_sub(1), z)].unwrap_or(y);
            let light = 100 + (y - north).clamp(-5, 5) * 4 + (y - west).clamp(-5, 5) * 2;
            for channel in &mut pixel.0[..3] {
                *channel = (i32::from(*channel) * light / 100).clamp(0, 255) as u8;
            }
        }
    }
}
