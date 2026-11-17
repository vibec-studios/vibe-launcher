//! CurseForge-Fingerprint: MurmurHash2 (32 Bit, Seed 1) über die Datei ohne Whitespace-Bytes
//! (Tab 9, LF 10, CR 13, Leerzeichen 32) – so berechnet CurseForge `fileFingerprint`.

const M: u32 = 0x5bd1e995;
const R: u32 = 24;

#[inline]
fn is_ws(b: u8) -> bool {
    matches!(b, 9 | 10 | 13 | 32)
}

/// MurmurHash2 über einen Byte-Iterator bekannter Länge.
fn murmur2<I: Iterator<Item = u8>>(bytes: I, len: u32, seed: u32) -> u32 {
    let mut h = seed ^ len;
    let mut buf = [0u8; 4];
    let mut n = 0usize;
    for b in bytes {
        buf[n] = b;
        n += 1;
        if n == 4 {
            let mut k = u32::from_le_bytes(buf);
            k = k.wrapping_mul(M);
            k ^= k >> R;
            k = k.wrapping_mul(M);
            h = h.wrapping_mul(M);
            h ^= k;
            n = 0;
        }
    }
    if n >= 3 {
        h ^= (buf[2] as u32) << 16;
    }
    if n >= 2 {
        h ^= (buf[1] as u32) << 8;
    }
    if n >= 1 {
        h ^= buf[0] as u32;
        h = h.wrapping_mul(M);
    }
    h ^= h >> 13;
    h = h.wrapping_mul(M);
    h ^= h >> 15;
    h
}

/// CurseForge-Fingerprint einer Datei (Inhalt im Speicher).
pub fn cf_fingerprint(data: &[u8]) -> u32 {
    let len = data.iter().filter(|b| !is_ws(**b)).count() as u32;
    murmur2(data.iter().copied().filter(|b| !is_ws(*b)), len, 1)
}

#[cfg(test)]
mod tests {
    use super::cf_fingerprint;

    /// Referenzwerte aus einer unabhängigen Implementierung (murmurhash-js `murmur2`, Seed 1,
    /// Whitespace vorher entfernt).
    #[test]
    fn vectors() {
        let cases: &[(&str, u32)] = &[
            ("", 1540447798),
            ("a", 626045324),
            ("ab", 1692487918),
            ("abc", 1621425345),
            ("abcd", 3376380438),
            ("Hello, World!", 1961219979),
            ("The quick brown fox jumps over the lazy dog", 3751777527),
            ("hello\tworld\r\n foo bar", 3868846180),
        ];
        for (s, want) in cases {
            assert_eq!(cf_fingerprint(s.as_bytes()), *want, "Eingabe {s:?}");
        }
    }

    #[test]
    fn whitespace_ignored() {
        assert_eq!(cf_fingerprint(b"a b\tc\r\nd"), cf_fingerprint(b"abcd"));
    }
}
