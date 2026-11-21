use super::*;

#[derive(Debug, Clone, PartialEq)]
pub enum Nbt {
    End,
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<i8>),
    String(String),
    List(u8, Vec<Nbt>),
    Compound(Vec<(String, Nbt)>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

impl Nbt {
    pub(super) fn id(&self) -> u8 {
        match self {
            Nbt::End => 0,
            Nbt::Byte(_) => 1,
            Nbt::Short(_) => 2,
            Nbt::Int(_) => 3,
            Nbt::Long(_) => 4,
            Nbt::Float(_) => 5,
            Nbt::Double(_) => 6,
            Nbt::ByteArray(_) => 7,
            Nbt::String(_) => 8,
            Nbt::List(..) => 9,
            Nbt::Compound(_) => 10,
            Nbt::IntArray(_) => 11,
            Nbt::LongArray(_) => 12,
        }
    }
    pub fn get(&self, k: &str) -> Option<&Nbt> {
        match self {
            Nbt::Compound(v) => v.iter().find(|(n, _)| n == k).map(|(_, t)| t),
            _ => None,
        }
    }
    pub(super) fn str(&self) -> Option<&str> {
        match self {
            Nbt::String(s) => Some(s),
            _ => None,
        }
    }
    pub(super) fn byte(&self) -> Option<i8> {
        match self {
            Nbt::Byte(b) => Some(*b),
            _ => None,
        }
    }
}

pub(super) struct Reader<'a> {
    pub(super) b: &'a [u8],
    pub(super) p: usize,
}

impl<'a> Reader<'a> {
    pub(super) fn take(&mut self, n: usize) -> AppResult<&'a [u8]> {
        if self.p + n > self.b.len() {
            return Err(AppError::msg(
                "servers.dat ist beschädigt (unerwartetes Ende)",
            ));
        }
        let s = &self.b[self.p..self.p + n];
        self.p += n;
        Ok(s)
    }
    pub(super) fn u8(&mut self) -> AppResult<u8> {
        Ok(self.take(1)?[0])
    }
    pub(super) fn i16(&mut self) -> AppResult<i16> {
        Ok(i16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }
    pub(super) fn i32(&mut self) -> AppResult<i32> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub(super) fn i64(&mut self) -> AppResult<i64> {
        Ok(i64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }
    pub(super) fn string(&mut self) -> AppResult<String> {
        let n = self.i16()? as u16 as usize;
        // Modified UTF-8 – für normale Texte identisch mit UTF-8
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
    pub(super) fn len(&mut self) -> AppResult<usize> {
        let n = self.i32()?;
        if n < 0 || n as usize > self.b.len() {
            return Err(AppError::msg("servers.dat ist beschädigt (Länge)"));
        }
        Ok(n as usize)
    }
    pub(super) fn payload(&mut self, id: u8, depth: u32) -> AppResult<Nbt> {
        if depth > 64 {
            return Err(AppError::msg("servers.dat ist zu tief verschachtelt"));
        }
        Ok(match id {
            1 => Nbt::Byte(self.u8()? as i8),
            2 => Nbt::Short(self.i16()?),
            3 => Nbt::Int(self.i32()?),
            4 => Nbt::Long(self.i64()?),
            5 => Nbt::Float(f32::from_bits(self.i32()? as u32)),
            6 => Nbt::Double(f64::from_bits(self.i64()? as u64)),
            7 => {
                let n = self.len()?;
                Nbt::ByteArray(self.take(n)?.iter().map(|b| *b as i8).collect())
            }
            8 => Nbt::String(self.string()?),
            9 => {
                let t = self.u8()?;
                let n = self.len()?;
                let mut v = Vec::with_capacity(n.min(4096));
                for _ in 0..n {
                    v.push(self.payload(t, depth + 1)?);
                }
                Nbt::List(t, v)
            }
            10 => {
                let mut v = vec![];
                loop {
                    let t = self.u8()?;
                    if t == 0 {
                        break;
                    }
                    let name = self.string()?;
                    v.push((name, self.payload(t, depth + 1)?));
                }
                Nbt::Compound(v)
            }
            11 => {
                let n = self.len()?;
                Nbt::IntArray((0..n).map(|_| self.i32()).collect::<AppResult<_>>()?)
            }
            12 => {
                let n = self.len()?;
                Nbt::LongArray((0..n).map(|_| self.i64()).collect::<AppResult<_>>()?)
            }
            _ => {
                return Err(AppError::msg(format!(
                    "servers.dat: unbekannter NBT-Typ {id}"
                )))
            }
        })
    }
}

pub fn nbt_read(b: &[u8]) -> AppResult<Nbt> {
    let mut r = Reader { b, p: 0 };
    let t = r.u8()?;
    if t != 10 {
        return Err(AppError::msg("servers.dat: kein NBT-Compound"));
    }
    let _name = r.string()?;
    r.payload(10, 0)
}

pub(super) fn w_str(out: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    out.extend((b.len().min(u16::MAX as usize) as u16).to_be_bytes());
    out.extend(&b[..b.len().min(u16::MAX as usize)]);
}

pub(super) fn w_payload(out: &mut Vec<u8>, t: &Nbt) {
    match t {
        Nbt::End => {}
        Nbt::Byte(v) => out.push(*v as u8),
        Nbt::Short(v) => out.extend(v.to_be_bytes()),
        Nbt::Int(v) => out.extend(v.to_be_bytes()),
        Nbt::Long(v) => out.extend(v.to_be_bytes()),
        Nbt::Float(v) => out.extend(v.to_bits().to_be_bytes()),
        Nbt::Double(v) => out.extend(v.to_bits().to_be_bytes()),
        Nbt::ByteArray(v) => {
            out.extend((v.len() as i32).to_be_bytes());
            out.extend(v.iter().map(|b| *b as u8));
        }
        Nbt::String(s) => w_str(out, s),
        Nbt::List(id, v) => {
            out.push(if v.is_empty() { *id } else { v[0].id() });
            out.extend((v.len() as i32).to_be_bytes());
            for x in v {
                w_payload(out, x);
            }
        }
        Nbt::Compound(v) => {
            for (n, x) in v {
                out.push(x.id());
                w_str(out, n);
                w_payload(out, x);
            }
            out.push(0);
        }
        Nbt::IntArray(v) => {
            out.extend((v.len() as i32).to_be_bytes());
            for x in v {
                out.extend(x.to_be_bytes());
            }
        }
        Nbt::LongArray(v) => {
            out.extend((v.len() as i32).to_be_bytes());
            for x in v {
                out.extend(x.to_be_bytes());
            }
        }
    }
}

pub fn nbt_write(root: &Nbt) -> Vec<u8> {
    let mut out = vec![10u8];
    w_str(&mut out, "");
    w_payload(&mut out, root);
    out
}
