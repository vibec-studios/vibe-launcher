pub const KINDS: [&str; 6] = ["latest_log", "debug_log", "crash_report", "hs_err", "launcher_log", "console"];
pub const LEVELS: [&str; 6] = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"];
pub const THREAD_BUCKETS: u32 = 64;
pub const POSITION_BUCKETS: usize = 32;

static CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut value = i as u32;
        let mut bit = 0;
        while bit < 8 {
            value = if value & 1 != 0 { 0xEDB8_8320 ^ (value >> 1) } else { value >> 1 };
            bit += 1;
        }
        table[i] = value;
        i += 1;
    }
    table
};

pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in data {
        crc = CRC_TABLE[((crc ^ byte as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    !crc
}

fn index_of(items: &[&str], value: &str) -> usize {
    items.iter().position(|item| *item == value).map_or(0, |i| i + 1)
}

pub fn feature_ids(kind: &str, level: Option<&str>, thread: Option<&str>, position: f64) -> [u32; 4] {
    let level = match level {
        Some("WARNING") => "WARN",
        Some(level) => level,
        None => "",
    };
    let thread = match thread {
        Some(name) if !name.is_empty() => crc32(name.as_bytes()) % (THREAD_BUCKETS - 1) + 1,
        _ => 0,
    };
    let bucket = ((position * POSITION_BUCKETS as f64) as usize).min(POSITION_BUCKETS - 1);
    [index_of(&KINDS, kind) as u32, index_of(&LEVELS, level) as u32, thread, bucket as u32]
}
