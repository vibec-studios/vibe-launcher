use std::cmp::Ordering;

use crate::tables::TABLES;

fn contains(table: &[(u32, u32)], c: char) -> bool {
    let cp = c as u32;
    table
        .binary_search_by(|&(lo, hi)| {
            if hi < cp {
                Ordering::Less
            } else if lo > cp {
                Ordering::Greater
            } else {
                Ordering::Equal
            }
        })
        .is_ok()
}

pub fn is_word(c: char) -> bool {
    if c.is_ascii() {
        c.is_ascii_alphanumeric() || c == '_'
    } else {
        contains(&TABLES.word, c)
    }
}

pub fn is_digit(c: char) -> bool {
    if c.is_ascii() {
        c.is_ascii_digit()
    } else {
        contains(&TABLES.digit, c)
    }
}

pub fn is_space(c: char) -> bool {
    if c.is_ascii() {
        matches!(c, '\t'..='\r' | '\x1c'..=' ')
    } else {
        contains(&TABLES.space, c)
    }
}

pub fn strip(text: &str) -> &str {
    text.trim_matches(is_space)
}

pub fn skip_space(text: &str, from: usize) -> usize {
    match text[from..].char_indices().find(|&(_, c)| !is_space(c)) {
        Some((i, _)) => from + i,
        None => text.len(),
    }
}

pub fn fold_matches(c: char, pattern: char) -> bool {
    if c.is_ascii() || !pattern.is_ascii_alphabetic() {
        return c.eq_ignore_ascii_case(&pattern);
    }
    match pattern.to_ascii_lowercase() {
        'i' => matches!(c, '\u{130}' | '\u{131}'),
        'k' => c == '\u{212A}',
        's' => c == '\u{17F}',
        _ => false,
    }
}

pub fn fold_prefix(text: &str, pattern: &str) -> Option<usize> {
    let mut chars = text.char_indices();
    for p in pattern.chars() {
        let (_, c) = chars.next()?;
        if !fold_matches(c, p) {
            return None;
        }
    }
    Some(chars.next().map_or(text.len(), |(i, _)| i))
}

pub fn dotted_i(text: &str) -> std::borrow::Cow<'_, str> {
    if text.is_ascii() || !text.contains(['\u{130}', '\u{131}']) {
        return std::borrow::Cow::Borrowed(text);
    }
    std::borrow::Cow::Owned(text.replace(['\u{130}', '\u{131}'], "i"))
}

pub fn casefold(text: &str) -> String {
    if text.is_ascii() {
        return text.to_ascii_lowercase();
    }
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii() {
            out.push(c.to_ascii_lowercase());
        } else {
            match TABLES.casefold.get(&(c as u32)) {
                Some(folded) => out.push_str(folded),
                None => out.push(c),
            }
        }
    }
    out
}
