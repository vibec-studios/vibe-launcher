use crate::unicode::{fold_matches, is_digit, is_word};

const EXTENSIONS: [&str; 8] = ["jar", "zip", "dll", "so", "dylib", "mca", "dat", "nbt"];

fn chars(text: &str) -> Vec<(usize, char)> {
    text.char_indices().collect()
}

fn end_byte(cs: &[(usize, char)], i: usize, text: &str) -> usize {
    cs.get(i).map_or(text.len(), |c| c.0)
}

fn word_or(c: char, extra: &str) -> bool {
    is_word(c) || extra.contains(c)
}

fn scan(text: &str, at: impl Fn(&[(usize, char)], usize) -> Option<usize>, behind: &str) -> Vec<(usize, usize)> {
    let cs = chars(text);
    let mut out = Vec::new();
    let mut i = 0;
    while i < cs.len() {
        let free = i == 0 || !word_or(cs[i - 1].1, behind);
        match at(&cs, i).filter(|_| free) {
            Some(end) => {
                out.push((cs[i].0, end_byte(&cs, end, text)));
                i = end.max(i + 1);
            }
            None => i += 1,
        }
    }
    out
}

fn run(cs: &[(usize, char)], from: usize, keep: impl Fn(char) -> bool) -> usize {
    cs[from..].iter().position(|&(_, c)| !keep(c)).map_or(cs.len(), |n| from + n)
}

fn class_at(cs: &[(usize, char)], p: usize) -> Option<usize> {
    let ident = |c: char| is_word(c) || c == '$';
    let head = |c: char| c.is_ascii_alphabetic() || c == '_';
    let mut segments = Vec::new();
    let mut at = p;
    while at < cs.len() && head(cs[at].1) {
        let end = run(cs, at + 1, ident);
        if end < cs.len() && matches!(cs[end].1, '.' | '/') {
            segments.push((at, end));
            at = end + 1;
        } else {
            break;
        }
    }
    let k = segments.len();
    if k >= 2 && at < cs.len() && (head(cs[at].1) || cs[at].1 == '$') {
        return Some(run(cs, at + 1, ident));
    }
    (k >= 3).then(|| segments[k - 1].1)
}

pub fn classes(text: &str) -> Vec<(usize, usize)> {
    scan(text, class_at, "$.")
}

fn file_at(cs: &[(usize, char)], p: usize) -> Option<usize> {
    let part = |c: char| word_or(c, ".+-");
    let end = run(cs, p, part);
    for q in (p + 1..end).rev() {
        if cs[q].1 != '.' {
            continue;
        }
        for ext in EXTENSIONS {
            let n = ext.len();
            if q + 1 + n > cs.len() || !ext.chars().zip(&cs[q + 1..q + 1 + n]).all(|(e, &(_, c))| fold_matches(c, e)) {
                continue;
            }
            let after = q + 1 + n;
            if after >= cs.len() || !word_or(cs[after].1, ".") {
                return Some(after);
            }
            break;
        }
    }
    None
}

pub fn files(text: &str) -> Vec<(usize, usize)> {
    scan(text, file_at, ".+-")
}

fn version_at(cs: &[(usize, char)], p: usize) -> Option<usize> {
    let start = if cs[p].1 == 'v' { p + 1 } else { p };
    let digits = run(cs, start, is_digit);
    if digits == start {
        return None;
    }
    let part = |c: char| word_or(c, "+-");
    let mut at = digits;
    let mut reps = 0;
    while at + 1 < cs.len() && cs[at].1 == '.' && part(cs[at + 1].1) {
        at = run(cs, at + 1, part);
        reps += 1;
    }
    (reps > 0).then_some(at)
}

pub fn versions(text: &str) -> Vec<(usize, usize)> {
    scan(text, version_at, ".+-")
}

fn ident_at(cs: &[(usize, char)], p: usize) -> Option<usize> {
    if !cs[p].1.is_ascii_lowercase() {
        return None;
    }
    let tail = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-';
    let end = run(cs, p + 1, tail);
    let length = end - (p + 1);
    if !(1..=48).contains(&length) {
        return None;
    }
    let blocked = cs
        .get(end)
        .is_some_and(|&(_, c)| word_or(c, "-/$(") || (c == '.' && cs.get(end + 1).is_some_and(|&(_, d)| is_word(d))));
    (!blocked).then_some(end)
}

pub fn idents(text: &str) -> Vec<(usize, usize)> {
    scan(text, ident_at, ".-/$")
}
