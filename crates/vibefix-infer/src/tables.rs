use std::collections::HashMap;
use std::sync::LazyLock;

const DATA: &str = include_str!("../data/unicode.txt");

pub struct Tables {
    pub version: String,
    pub word: Vec<(u32, u32)>,
    pub digit: Vec<(u32, u32)>,
    pub space: Vec<(u32, u32)>,
    pub casefold: HashMap<u32, String>,
}

fn hex(value: &str) -> u32 {
    u32::from_str_radix(value, 16).expect("unicode.txt")
}

fn ranges(body: &str) -> Vec<(u32, u32)> {
    body.split_whitespace()
        .map(|item| {
            let (a, b) = item.split_once('-').expect("unicode.txt");
            (hex(a), hex(b))
        })
        .collect()
}

fn folds(body: &str) -> HashMap<u32, String> {
    body.split_whitespace()
        .map(|item| {
            let (cp, chars) = item.split_once(':').expect("unicode.txt");
            (hex(cp), chars.split(',').filter_map(|c| char::from_u32(hex(c))).collect())
        })
        .collect()
}

pub static TABLES: LazyLock<Tables> = LazyLock::new(|| {
    let mut tables = Tables {
        version: String::new(),
        word: Vec::new(),
        digit: Vec::new(),
        space: Vec::new(),
        casefold: HashMap::new(),
    };
    for line in DATA.lines() {
        let (name, body) = line.split_once(' ').unwrap_or((line, ""));
        match name {
            "unicode" => tables.version = body.to_owned(),
            "word" => tables.word = ranges(body),
            "digit" => tables.digit = ranges(body),
            "space" => tables.space = ranges(body),
            "casefold" => tables.casefold = folds(body),
            _ => {}
        }
    }
    tables
});

pub fn unicode_version() -> &'static str {
    &TABLES.version
}
