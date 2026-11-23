use crate::unicode::{is_digit, is_word};

fn upper(c: char) -> bool {
    c.is_ascii_uppercase()
}

fn lower(c: char) -> bool {
    c.is_ascii_lowercase()
}

fn other_word(c: char) -> bool {
    is_word(c) && !is_digit(c) && c != '_' && !c.is_ascii_alphabetic()
}

fn run(text: &str, from: usize, keep: impl Fn(char) -> bool) -> usize {
    match text[from..].char_indices().find(|&(_, c)| !keep(c)) {
        Some((i, _)) => from + i,
        None => text.len(),
    }
}

fn next(text: &str, at: usize) -> Option<char> {
    text[at..].chars().next()
}

fn part_end(text: &str, at: usize) -> usize {
    let c = next(text, at).unwrap();
    if is_digit(c) {
        return at + c.len_utf8();
    }
    if upper(c) {
        let end = run(text, at, upper);
        let follows = next(text, end).is_some_and(lower);
        if end - at >= 2 && follows {
            return end - 1;
        }
        if end - at == 1 && follows {
            return run(text, end, lower);
        }
        return end;
    }
    if lower(c) {
        return run(text, at, lower);
    }
    if other_word(c) {
        return run(text, at, other_word);
    }
    if c == ' ' || c == '\t' {
        return run(text, at, |c| c == ' ' || c == '\t');
    }
    at + c.len_utf8()
}

pub struct Parts<'a> {
    text: &'a str,
    at: usize,
}

impl<'a> Iterator for Parts<'a> {
    type Item = &'a str;

    fn next(&mut self) -> Option<&'a str> {
        if self.at >= self.text.len() {
            return None;
        }
        let start = self.at;
        self.at = part_end(self.text, start);
        Some(&self.text[start..self.at])
    }
}

pub fn parts(text: &str) -> Parts<'_> {
    Parts { text, at: 0 }
}
