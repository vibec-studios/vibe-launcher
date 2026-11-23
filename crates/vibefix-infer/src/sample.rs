use std::borrow::Cow;
use std::collections::VecDeque;
use std::io::Read;
use std::sync::LazyLock;

use regex::bytes::Regex;

pub const CHUNK: usize = 256 * 1024;
pub const WINDOW: usize = 96 * 1024;
pub const MAX_TEXT_BYTES: usize = 4 * CHUNK;
const HITS: usize = 35;
const SEPARATOR: &[u8] = b"\n[... lines omitted ...]\n";

static MARKERS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?i-u)/(?:error|fatal)\]|caused by:|suppressed:|minecraft crash report|mod list:|",
        r"exit(?:ed)? code|incompatible mods|failed to start|crash report saved|",
        r"loading minecraft |modlauncher running: args|starting minecraft server version"
    ))
    .unwrap()
});
static MODS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i-u)loading \d+ mods:|mod list:|fabric mods:").unwrap());
const MARKER_PREFIXES: [&[u8]; 14] = [
    b"/error]",
    b"/fatal]",
    b"caused by:",
    b"suppressed:",
    b"minecraft crash report",
    b"mod list:",
    b"exit code",
    b"exited code",
    b"incompatible mods",
    b"failed to start",
    b"crash report saved",
    b"loading minecraft ",
    b"modlauncher running: args",
    b"starting minecraft server version",
];

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

fn newline_after(hay: &[u8], from: usize) -> Option<usize> {
    hay.get(from..)?.iter().position(|&b| b == b'\n').map(|i| i + from)
}

fn line_start(hay: &[u8], before: usize) -> usize {
    hay[..before].iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1)
}

fn keep_tail(data: &mut Vec<u8>, keep: usize) {
    if data.len() > keep {
        data.drain(..data.len() - keep);
    }
}

pub fn read_up_to(reader: &mut dyn Read, limit: usize) -> Vec<u8> {
    let mut data = Vec::new();
    let _ = reader.take(limit as u64).read_to_end(&mut data);
    data
}

type Hit = (usize, Vec<u8>);

#[derive(Default)]
struct Hits {
    start: Vec<Hit>,
    last: VecDeque<Hit>,
    mods: Vec<Hit>,
}

impl Hits {
    fn markers(&mut self, current: &[u8], offset: usize) {
        let mut previous = 0;
        for found in MARKERS.find_iter(current) {
            if found.start() < previous {
                continue;
            }
            let start = line_start(current, found.start());
            let mut end = newline_after(current, found.end());
            for _ in 0..5 {
                match end {
                    Some(e) => end = newline_after(current, e + 1),
                    None => break,
                }
            }
            let end = end.unwrap_or(current.len());
            if end <= start {
                continue;
            }
            previous = end;
            let hit = (offset + start, current[start..end.min(start + 4096)].to_vec());
            if self.start.len() < HITS {
                self.start.push(hit);
            } else {
                if self.last.len() == HITS {
                    self.last.pop_front();
                }
                self.last.push_back(hit);
            }
        }
    }

    fn mod_blocks(&mut self, current: &[u8], offset: usize) {
        for found in MODS.find_iter(current) {
            if self.mods.len() == 3 {
                break;
            }
            let Some(end) = newline_after(current, found.end()) else { continue };
            let start = line_start(current, found.start());
            self.mods.push((offset + start, current[start..(end + 16_000).min(current.len())].to_vec()));
        }
    }
}

pub fn sample_log(reader: &mut dyn Read, head: Vec<u8>) -> Vec<u8> {
    let first = head[..head.len().min(2 * WINDOW)].to_vec();
    let mut last: Vec<u8> = Vec::new();
    let mut hits = Hits::default();
    let mut chunk = head;
    let mut offset = 0;
    while !chunk.is_empty() {
        let safe_end = chunk.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
        let current = if safe_end > 0 { &chunk[..safe_end] } else { &chunk[..] };
        last.extend_from_slice(current);
        keep_tail(&mut last, WINDOW);
        let lower = current.to_ascii_lowercase();
        if MARKER_PREFIXES.iter().any(|m| contains(&lower, m)) {
            hits.markers(current, offset);
        }
        if hits.mods.len() < 3 && (contains(&lower, b" mods:") || contains(&lower, b"mod list:")) {
            hits.mod_blocks(current, offset);
        }
        let rest = if safe_end > 0 { chunk[safe_end..].to_vec() } else { Vec::new() };
        offset += current.len();
        let data = read_up_to(reader, CHUNK);
        if data.is_empty() {
            last.extend_from_slice(&rest);
            keep_tail(&mut last, WINDOW);
            offset += rest.len();
            break;
        }
        chunk = rest;
        chunk.extend_from_slice(&data);
    }
    let limit = offset - last.len();
    let mut middle: Vec<Hit> = hits
        .start
        .into_iter()
        .chain(hits.last)
        .chain(hits.mods)
        .filter(|(position, data)| first.len() < *position && position + data.len() < limit)
        .collect();
    middle.sort();
    let head_part = match first.iter().rposition(|&b| b == b'\n') {
        Some(i) => &first[..i],
        None => &first[..],
    };
    let mut output: Vec<&[u8]> = vec![head_part];
    let mut last_position = first.len();
    for (position, data) in &middle {
        if *position < last_position {
            continue;
        }
        output.push(data);
        last_position = position + data.len();
    }
    output.push(match newline_after(&last, 0) {
        Some(i) => &last[i + 1..],
        None => &[],
    });
    output.join(SEPARATOR)
}

pub fn bound_text(text: &str) -> Cow<'_, str> {
    if text.len() <= MAX_TEXT_BYTES {
        return Cow::Borrowed(text);
    }
    let bytes = text.as_bytes();
    let head = bytes[..MAX_TEXT_BYTES + 1].to_vec();
    let mut rest = &bytes[MAX_TEXT_BYTES + 1..];
    Cow::Owned(crate::readlog::decode_normalized(sample_log(&mut rest, head)))
}
