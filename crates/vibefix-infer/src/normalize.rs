use std::sync::LazyLock;

use regex::Regex;
use unicode_normalization::{is_nfc_quick, IsNormalized, UnicodeNormalization};

static ANSI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]").unwrap());

fn is_control(c: char) -> bool {
    matches!(c, '\0'..='\x08' | '\x0b'..='\x1f' | '\x7f'..='\u{9f}')
}

pub fn normalize(text: &str) -> String {
    let composed: String;
    let mut text = text;
    if !text.is_ascii() && is_nfc_quick(text.chars()) != IsNormalized::Yes {
        composed = text.nfc().collect();
        text = &composed;
    }
    let unified = text.replace("\r\n", "\n").replace('\r', "\n");
    let cleaned = if unified.contains('\x1b') { ANSI.replace_all(&unified, "").into_owned() } else { unified };
    let trimmed = cleaned.trim_start_matches('\u{feff}');
    if trimmed.chars().any(is_control) {
        trimmed.chars().filter(|&c| !is_control(c)).collect()
    } else {
        trimmed.to_owned()
    }
}
