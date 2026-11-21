use super::*;

#[derive(Debug, PartialEq, Eq)]
pub enum Decoded {
    Image,
    Empty,
    Cancelled,
    Unsupported { major: u16, minor: i32 },
}

#[derive(Clone, Copy)]
pub(super) struct Framing {
    pub(super) major: u16,
    pub(super) minor: i32,
    pub(super) v2: bool,
}

impl Framing {
    pub(super) fn legacy_slope(self) -> bool {
        self.minor < 5 || (self.major <= 2 && !self.v2)
    }

    pub(super) fn height_shift(self) -> u32 {
        if self.minor >= 4 {
            25
        } else {
            24
        }
    }
}

#[derive(Default)]
pub(super) struct Palettes {
    pub(super) states: Vec<Block>,
    pub(super) biomes: Vec<Climate>,
}

pub(super) struct Overlay {
    pub(super) block: Block,
    pub(super) opacity: i32,
}

pub fn decode(stream: &[u8], canvas: &mut Canvas, cancelled: &dyn Fn() -> bool) -> Decoded {
    let mut reader = Reader::new(stream);
    let Ok(first) = reader.u8() else {
        return Decoded::Empty;
    };
    let (framing, mut pending) = if first == 0xFF {
        let Ok(packed) = reader.i32() else {
            return Decoded::Empty;
        };
        let major = ((packed >> 16) & 0xFFFF) as u16;
        let minor = packed & 0xFFFF;
        if major > MAX_MAJOR || minor > MAX_MINOR {
            return Decoded::Unsupported { major, minor };
        }
        let v2 = major == 2 && minor >= 5 && reader.u8().is_ok_and(|flag| flag == 1);
        (Framing { major, minor, v2 }, None)
    } else {
        (
            Framing {
                major: 0,
                minor: -1,
                v2: false,
            },
            Some(first),
        )
    };
    let mut palettes = Palettes::default();
    loop {
        if cancelled() {
            return Decoded::Cancelled;
        }
        let marker = match pending.take() {
            Some(marker) => marker,
            None if reader.is_done() => break,
            None => match reader.u8() {
                Ok(marker) => marker,
                Err(Eof) => break,
            },
        };
        if marker & 0x88 != 0 {
            break;
        }
        let cx = u32::from(marker >> 4);
        let cz = u32::from(marker & 15);
        if chunk(&mut reader, framing, &mut palettes, canvas, cx, cz).is_err() {
            break;
        }
    }
    if canvas.painted {
        Decoded::Image
    } else {
        Decoded::Empty
    }
}
