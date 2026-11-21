pub struct Eof;

pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

const MAX_DEPTH: u32 = 64;

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    pub fn is_done(&self) -> bool {
        self.pos >= self.buf.len()
    }

    pub fn u8(&mut self) -> Result<u8, Eof> {
        Ok(self.take(1)?[0])
    }

    pub fn u16(&mut self) -> Result<u16, Eof> {
        let b = self.take(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }

    pub fn i32(&mut self) -> Result<i32, Eof> {
        let b = self.take(4)?;
        Ok(i32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    pub fn take(&mut self, n: usize) -> Result<&'a [u8], Eof> {
        let end = self.pos.checked_add(n).ok_or(Eof)?;
        let slice = self.buf.get(self.pos..end).ok_or(Eof)?;
        self.pos = end;
        Ok(slice)
    }

    fn length(&mut self) -> Result<usize, Eof> {
        usize::try_from(self.i32()?).map_err(|_| Eof)
    }

    pub fn state_name(&mut self) -> Result<Option<String>, Eof> {
        let tag = self.u8()?;
        if tag == 0 {
            return Ok(None);
        }
        let len = self.u16()? as usize;
        self.take(len)?;
        if tag != 10 {
            self.skip(tag, 0)?;
            return Ok(None);
        }
        let mut name = None;
        loop {
            let tag = self.u8()?;
            if tag == 0 {
                return Ok(name);
            }
            let len = self.u16()? as usize;
            let key = self.take(len)?;
            if tag == 8 && name.is_none() && (key == b"Name" || key == b"id") {
                let len = self.u16()? as usize;
                name = Some(String::from_utf8_lossy(self.take(len)?).into_owned());
            } else {
                self.skip(tag, 1)?;
            }
        }
    }

    fn skip(&mut self, tag: u8, depth: u32) -> Result<(), Eof> {
        if depth > MAX_DEPTH {
            return Err(Eof);
        }
        let fixed = match tag {
            1 => 1,
            2 => 2,
            3 | 5 => 4,
            4 | 6 => 8,
            _ => 0,
        };
        if fixed > 0 {
            self.take(fixed)?;
            return Ok(());
        }
        match tag {
            7 => {
                let n = self.length()?;
                self.take(n)?;
            }
            8 => {
                let n = self.u16()? as usize;
                self.take(n)?;
            }
            9 => {
                let element = self.u8()?;
                let n = self.length()?;
                if element == 0 && n > 0 {
                    return Err(Eof);
                }
                for _ in 0..n {
                    self.skip(element, depth + 1)?;
                }
            }
            10 => loop {
                let tag = self.u8()?;
                if tag == 0 {
                    break;
                }
                let n = self.u16()? as usize;
                self.take(n)?;
                self.skip(tag, depth + 1)?;
            },
            11 => {
                let n = self.length()?.checked_mul(4).ok_or(Eof)?;
                self.take(n)?;
            }
            12 => {
                let n = self.length()?.checked_mul(8).ok_or(Eof)?;
                self.take(n)?;
            }
            _ => return Err(Eof),
        }
        Ok(())
    }
}
