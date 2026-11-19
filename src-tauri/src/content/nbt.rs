//! Minimaler NBT-Leser (Big Endian, wie in `level.dat`). Liest den kompletten Baum.
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Tag {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(usize),
    String(String),
    List(Vec<Tag>),
    Compound(HashMap<String, Tag>),
    IntArray(usize),
    LongArray(usize),
}

impl Tag {
    pub fn get(&self, key: &str) -> Option<&Tag> {
        match self {
            Tag::Compound(m) => m.get(key),
            _ => None,
        }
    }
    pub fn as_i64(&self) -> Option<i64> {
        Some(match self {
            Tag::Byte(v) => *v as i64,
            Tag::Short(v) => *v as i64,
            Tag::Int(v) => *v as i64,
            Tag::Long(v) => *v,
            _ => return None,
        })
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Tag::String(s) => Some(s),
            _ => None,
        }
    }
}

struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
    depth: usize,
}

type R<T> = Result<T, String>;

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> R<&'a [u8]> {
        if self.pos + n > self.b.len() {
            return Err("NBT: unerwartetes Dateiende".into());
        }
        let s = &self.b[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }
    fn u8(&mut self) -> R<u8> {
        Ok(self.take(1)?[0])
    }
    fn i16(&mut self) -> R<i16> {
        Ok(i16::from_be_bytes(self.take(2)?.try_into().map_err(|_| "NBT")?))
    }
    fn i32(&mut self) -> R<i32> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().map_err(|_| "NBT")?))
    }
    fn i64(&mut self) -> R<i64> {
        Ok(i64::from_be_bytes(self.take(8)?.try_into().map_err(|_| "NBT")?))
    }
    fn len(&mut self) -> R<usize> {
        let n = self.i32()?;
        if n < 0 {
            return Ok(0);
        }
        Ok(n as usize)
    }
    fn string(&mut self) -> R<String> {
        let n = self.i16()? as u16 as usize;
        Ok(String::from_utf8_lossy(self.take(n)?).to_string())
    }
    fn payload(&mut self, t: u8) -> R<Tag> {
        Ok(match t {
            1 => Tag::Byte(self.u8()? as i8),
            2 => Tag::Short(self.i16()?),
            3 => Tag::Int(self.i32()?),
            4 => Tag::Long(self.i64()?),
            5 => Tag::Float(f32::from_bits(self.i32()? as u32)),
            6 => Tag::Double(f64::from_bits(self.i64()? as u64)),
            7 => {
                let n = self.len()?;
                self.take(n)?;
                Tag::ByteArray(n)
            }
            8 => Tag::String(self.string()?),
            9 => {
                let et = self.u8()?;
                let n = self.len()?;
                self.depth += 1;
                if self.depth > 512 {
                    return Err("NBT: zu tief verschachtelt".into());
                }
                let mut v = Vec::with_capacity(n.min(4096));
                for _ in 0..n {
                    if et == 0 {
                        break;
                    }
                    v.push(self.payload(et)?);
                }
                self.depth -= 1;
                Tag::List(v)
            }
            10 => {
                self.depth += 1;
                if self.depth > 512 {
                    return Err("NBT: zu tief verschachtelt".into());
                }
                let mut m = HashMap::new();
                loop {
                    let t = self.u8()?;
                    if t == 0 {
                        break;
                    }
                    let name = self.string()?;
                    let v = self.payload(t)?;
                    m.insert(name, v);
                }
                self.depth -= 1;
                Tag::Compound(m)
            }
            11 => {
                let n = self.len()?;
                self.take(n.checked_mul(4).ok_or("NBT")?)?;
                Tag::IntArray(n)
            }
            12 => {
                let n = self.len()?;
                self.take(n.checked_mul(8).ok_or("NBT")?)?;
                Tag::LongArray(n)
            }
            t => return Err(format!("NBT: unbekannter Tag-Typ {t}")),
        })
    }
}

/// Unkomprimiertes NBT lesen (Wurzel = benanntes Compound).
pub fn parse(b: &[u8]) -> R<Tag> {
    let mut r = Reader { b, pos: 0, depth: 0 };
    let t = r.u8()?;
    if t != 10 {
        return Err("NBT: Wurzel ist kein Compound".into());
    }
    let _name = r.string()?;
    r.payload(10)
}

/// gzip-komprimiertes (oder unkomprimiertes) NBT lesen.
pub fn parse_maybe_gzip(b: &[u8]) -> R<Tag> {
    if b.starts_with(&[0x1f, 0x8b]) {
        use std::io::Read;
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(b).take(64 * 1024 * 1024).read_to_end(&mut out).map_err(|e| format!("gzip: {e}"))?;
        parse(&out)
    } else {
        parse(b)
    }
}

#[cfg(test)]
pub mod writer {
    //! Kleiner NBT-Schreiber nur für Tests.
    #[derive(Default)]
    pub struct W(pub Vec<u8>);
    impl W {
        pub fn new() -> Self {
            W(Vec::new())
        }
        fn name(&mut self, t: u8, n: &str) {
            self.0.push(t);
            self.0.extend((n.len() as u16).to_be_bytes());
            self.0.extend(n.as_bytes());
        }
        pub fn begin(&mut self, n: &str) -> &mut Self {
            self.name(10, n);
            self
        }
        pub fn end(&mut self) -> &mut Self {
            self.0.push(0);
            self
        }
        pub fn byte(&mut self, n: &str, v: i8) -> &mut Self {
            self.name(1, n);
            self.0.push(v as u8);
            self
        }
        pub fn int(&mut self, n: &str, v: i32) -> &mut Self {
            self.name(3, n);
            self.0.extend(v.to_be_bytes());
            self
        }
        pub fn long(&mut self, n: &str, v: i64) -> &mut Self {
            self.name(4, n);
            self.0.extend(v.to_be_bytes());
            self
        }
        pub fn string(&mut self, n: &str, v: &str) -> &mut Self {
            self.name(8, n);
            self.0.extend((v.len() as u16).to_be_bytes());
            self.0.extend(v.as_bytes());
            self
        }
        pub fn int_list(&mut self, n: &str, v: &[i32]) -> &mut Self {
            self.name(9, n);
            self.0.push(3);
            self.0.extend((v.len() as i32).to_be_bytes());
            for x in v {
                self.0.extend(x.to_be_bytes());
            }
            self
        }
        pub fn long_array(&mut self, n: &str, v: &[i64]) -> &mut Self {
            self.name(12, n);
            self.0.extend((v.len() as i32).to_be_bytes());
            for x in v {
                self.0.extend(x.to_be_bytes());
            }
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::writer::W;
    use super::*;

    #[test]
    fn roundtrip() {
        let mut w = W::new();
        w.begin("")
            .begin("Data")
            .string("LevelName", "Meine Welt äöü")
            .long("LastPlayed", 1_700_000_000_000)
            .int("GameType", 1)
            .byte("hardcore", 0)
            .int_list("L", &[1, 2, 3])
            .long_array("LA", &[5, 6])
            .end()
            .end();
        let t = parse(&w.0).unwrap();
        let d = t.get("Data").unwrap();
        assert_eq!(d.get("LevelName").and_then(|v| v.as_str()), Some("Meine Welt äöü"));
        assert_eq!(d.get("LastPlayed").and_then(|v| v.as_i64()), Some(1_700_000_000_000));
        assert_eq!(d.get("GameType").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(d.get("L"), Some(&Tag::List(vec![Tag::Int(1), Tag::Int(2), Tag::Int(3)])));
        assert!(parse(&w.0[..w.0.len() - 3]).is_err());
    }
}
