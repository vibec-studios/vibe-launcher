use std::io::Read;
use std::path::Path;
use std::sync::LazyLock;

use flate2::read::GzDecoder;
use regex::Regex;

use crate::normalize::normalize;
use crate::sample::{read_up_to, sample_log, CHUNK};

pub const MAX_BYTES: usize = 16 * 1024 * 1024;

static JVM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?im)^# (?:A fatal error has been detected by the Java Runtime Environment|",
        r"There is insufficient memory for the Java Runtime Environment)"
    ))
    .unwrap()
});
static CRASH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?im)^(?:[ >]*-{4} Minecraft Crash Report|-{2} .+? Details -{2}|Description: .+)$").unwrap()
});
static LAUNCHER_HEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?im)^\s*(?:Prism Launcher|MultiMC|PolyMC|ATLauncher|VibeLauncher|NoRisk Launcher|Modrinth App) ",
        r"version[: ]"
    ))
    .unwrap()
});
static LOG_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?m)^(?:[ \t>]*)(?:\[\d{2}:\d{2}:\d{2}|\[\d{2}[A-Za-z]{3}\d{4}|",
        r"\[[^\]\n]+/(?:INFO|WARN|ERROR|FATAL|DEBUG)\]|",
        r"(?:\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2})[ T:\[].{0,110}?\b(?:INFO|WARN|ERROR|FATAL|DEBUG)\b)"
    ))
    .unwrap()
});

pub fn identify(text: &str, name: &str) -> &'static str {
    let stem = name.to_lowercase();
    if JVM.is_match(text) || stem.starts_with("hs_err") {
        return "hs_err";
    }
    let report = text.contains("Minecraft Crash Report") || text.contains("Stacktrace:");
    if stem.contains("crash-") || (report && CRASH.is_match(text)) {
        return "crash_report";
    }
    if stem.contains("debug.log") {
        return "debug_log";
    }
    if ["launcher", "prism", "multimc"].iter().any(|w| stem.contains(w)) || LAUNCHER_HEADER.is_match(text) {
        return "launcher_log";
    }
    if stem.contains("latest.log") || LOG_LINE.is_match(text) {
        return "latest_log";
    }
    "console"
}

fn utf16(data: &[u8]) -> String {
    let little = data.starts_with(b"\xff\xfe");
    let body = &data[2..];
    let units = body.chunks_exact(2).map(|p| {
        if little {
            u16::from_le_bytes([p[0], p[1]])
        } else {
            u16::from_be_bytes([p[0], p[1]])
        }
    });
    let mut text: String = char::decode_utf16(units).map(|r| r.unwrap_or(char::REPLACEMENT_CHARACTER)).collect();
    if body.len() % 2 == 1 {
        text.push(char::REPLACEMENT_CHARACTER);
    }
    text
}

fn decode_file(mut data: Vec<u8>) -> String {
    if data.starts_with(b"\x1f\x8b") {
        data = read_up_to(&mut GzDecoder::new(&data[..]), MAX_BYTES + 1);
    }
    if data.len() > MAX_BYTES {
        return String::new();
    }
    if data.starts_with(b"\xff\xfe") || data.starts_with(b"\xfe\xff") {
        return utf16(&data);
    }
    if data[..data.len().min(2048)].contains(&0) {
        return String::new();
    }
    let body = data.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&data);
    String::from_utf8_lossy(body).into_owned()
}

pub fn decode_normalized(data: Vec<u8>) -> String {
    normalize(&decode_file(data))
}

fn read_stream(stream: &mut dyn Read) -> String {
    let mut data = read_up_to(stream, 4 * CHUNK + 1);
    let wide = data.starts_with(b"\xff\xfe") || data.starts_with(b"\xfe\xff");
    if data.len() > 4 * CHUNK && !wide {
        data = sample_log(stream, data);
    } else if data.len() > 4 * CHUNK {
        data.extend(read_up_to(stream, 15 * CHUNK));
    }
    decode_normalized(data)
}

pub fn read_log_bytes(data: &[u8]) -> String {
    let mut reader = data;
    read_stream(&mut reader)
}

pub fn read_log(path: &Path) -> String {
    let Ok(file) = std::fs::File::open(path) else { return String::new() };
    let mut file = std::io::BufReader::new(file);
    if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("gz")) {
        read_stream(&mut GzDecoder::new(file))
    } else {
        read_stream(&mut file)
    }
}
