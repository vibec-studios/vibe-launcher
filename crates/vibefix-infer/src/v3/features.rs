use std::borrow::Cow;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Map, Value};

use crate::host::metadata::last_exit_code;
use crate::host::pyre::Hay;
use crate::v2::prepare::Prepared;
use crate::LogFile;

const WINDOW: usize = 65_536;
pub const COUNT: usize = 24;
pub const DEBUG: usize = 16;
const FLAG_INDICES: [usize; 7] = [0, 1, 9, 10, 12, 13, 14];
const EVENT_COUNT: usize = 11;

static EVENTS: LazyLock<Regex> = LazyLock::new(|| {
    let patterns: [String; EVENT_COUNT] =
        serde_json::from_str(include_str!("../../data/v3_events.json")).expect("VibeFix v3 Ereignistabelle");
    let joined = patterns.iter().map(|pattern| format!("({pattern})")).collect::<Vec<_>>().join("|");
    let events = Regex::new(&format!("(?im){joined}")).expect("VibeFix v3 Ereignismuster");
    assert_eq!(events.captures_len(), EVENT_COUNT + 1);
    events
});

fn edges(text: &str) -> Cow<'_, str> {
    if text.len() <= 2 * WINDOW {
        return Cow::Borrowed(text);
    }
    let mut positions = text.char_indices();
    let Some((start, _)) = positions.nth(WINDOW) else { return Cow::Borrowed(text) };
    let Some((end, _)) = positions.rev().nth(WINDOW - 1) else { return Cow::Borrowed(text) };
    Cow::Owned(format!("{}\n{}", &text[..start], &text[end..]))
}

fn inspect(file: &LogFile) -> [bool; 17] {
    let text = edges(&file.text);
    let text = if text.contains(['İ', 'ı']) { Cow::Owned(text.replace(['İ', 'ı'], "i")) } else { text };
    let mut last = [None; EVENT_COUNT];
    for captures in EVENTS.captures_iter(&text) {
        for (index, found) in captures.iter().skip(1).enumerate() {
            if let Some(found) = found {
                last[index] = Some(found.start());
                break;
            }
        }
    }
    let [report, jvm, reported, startup, terminal, ordinary, stack, stopping, progress, active, debug] = last;
    let code = last_exit_code(&Hay::new(&text));
    let has_code = !code.is_null();
    let zero = code.as_f64() == Some(0.0);
    let report = file.kind == "crash_report" || report.is_some();
    let jvm = file.kind == "hs_err" || jvm.is_some();
    let failure = terminal.max(startup);
    let error = ordinary.max(failure);
    let progressed = progress.max(active);
    let shutdown = stopping > error.max(progressed);
    let stack_tail = stack > progressed.max(stopping);
    [
        report,
        jvm,
        reported.is_some(),
        has_code && !zero,
        zero,
        false,
        startup > progressed,
        failure > progressed,
        (error.is_some() && error >= progressed) || stack_tail,
        ordinary.is_some(),
        stack_tail,
        shutdown,
        progressed.is_some(),
        error.is_some() && progressed > error,
        active.is_some() && progressed > error && !shutdown && !has_code && !report && !jvm,
        false,
        debug.is_some(),
    ]
}

pub fn extract(files: &[LogFile], meta: Option<&Map<String, Value>>, prepared: &Prepared) -> [f32; COUNT] {
    let mut bits = [false; COUNT];
    for file in files {
        for (slot, bit) in bits.iter_mut().zip(inspect(file)) {
            *slot |= bit;
        }
    }
    if let Some(code) = meta.and_then(|m| m.get("exit_code")).filter(|v| !v.is_null()) {
        bits[4] = code.as_f64() == Some(0.0) || code.as_bool() == Some(false);
        bits[3] = !bits[4];
    }
    bits[5] = bits[3] && bits[8];
    bits[15] = bits[4] && !bits[3];
    for (slot, flag) in bits[17..].iter_mut().zip(FLAG_INDICES) {
        *slot = prepared.flags[flag] > 0.0;
    }
    bits.map(|value| f32::from(u8::from(value)))
}
