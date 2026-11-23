use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::LogFile;

const BUILTIN: [&str; 11] = [
    "minecraft",
    "java",
    "fabricloader",
    "fabric-loader",
    "forge",
    "neoforge",
    "quilt_loader",
    "mixinextras",
    "mcp",
    "fml",
    "javafml",
];
pub const LOADER_IDS: [&str; 5] = ["fabricloader", "fabric-loader", "forge", "neoforge", "quilt_loader"];
static CONFIG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r#"(?i)(?:^|[^\w])config[\\/](?P<rel>[^\s'"()\[\],;]+?\."#,
        r"(?:json5|jsonc|json|toml|cfg|conf|properties|yaml|yml|txt|snbt|ini))\b"
    ))
    .unwrap()
});
static SECTION_SIGN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)§.?").unwrap());

pub fn file_order(kind: &str) -> usize {
    match kind {
        "crash_report" => 0,
        "hs_err" => 1,
        "latest_log" => 2,
        "debug_log" => 3,
        "console" => 4,
        "launcher_log" => 5,
        _ => 6,
    }
}

pub fn ascii_lower(value: &str) -> String {
    value.to_ascii_lowercase()
}

pub fn builtin(value: &str) -> bool {
    BUILTIN.contains(&ascii_lower(value).as_str())
}

pub fn noise(value: &str) -> bool {
    builtin(value) || value.starts_with("fabric-") || value.starts_with("fabric_") || value == "fabric-api"
}

pub fn normalize(text: &str) -> String {
    let unified = text.replace("\r\n", "\n");
    if unified.contains('§') {
        SECTION_SIGN.replace_all(&unified, "").into_owned()
    } else {
        unified
    }
}

pub fn rust_lines(text: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    lines
}

pub fn safe_rel(rel: &str) -> Option<String> {
    let mut rel = rel;
    while let Some(rest) = rel.strip_prefix("./") {
        rel = rest;
    }
    let ok = !rel.is_empty() && !rel.contains(':') && rel.split('/').all(|part| !part.is_empty() && part != "..");
    ok.then(|| rel.to_owned())
}

pub fn config_path(text: &str) -> Option<String> {
    let caps = CONFIG.captures(text)?;
    safe_rel(&caps["rel"].replace('\\', "/")).map(|rel| format!("config/{rel}"))
}

pub fn clean_range(value: &str) -> String {
    let value = crate::unicode::strip(value);
    if ascii_lower(value) == "any version" || value == "*" {
        String::new()
    } else {
        value.strip_prefix("version ").unwrap_or(value).to_owned()
    }
}

fn numbers(text: &str) -> Vec<&str> {
    text.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).collect()
}

pub fn small_uint(digits: &str) -> Option<u64> {
    let trimmed = digits.trim_start_matches('0');
    if trimmed.len() > 10 {
        return None;
    }
    digits.parse::<u64>().ok().filter(|&v| v <= u64::from(u32::MAX))
}

pub fn recommended_java(mc: Option<&str>) -> Option<i64> {
    let mc = mc.filter(|m| !m.is_empty())?;
    let nums: Vec<u64> = numbers(mc).into_iter().take(3).filter_map(small_uint).collect();
    if mc.starts_with("1.") && nums.len() >= 2 {
        let (minor, patch) = (nums[1], nums.get(2).copied().unwrap_or(0));
        if minor <= 16 {
            return Some(8);
        }
        return Some(if minor <= 19 || (minor == 20 && patch <= 4) { 17 } else { 21 });
    }
    (!nums.is_empty() && nums[0] >= 26 && !mc.contains('w')).then_some(25)
}

pub fn source_files(files: &[LogFile]) -> Vec<&LogFile> {
    let mut sorted: Vec<&LogFile> = files.iter().collect();
    sorted.sort_by_key(|f| file_order(&f.kind));
    sorted
}

pub struct Source {
    pub kind: String,
    pub name: String,
    pub text: String,
    breaks: Vec<usize>,
}

impl Source {
    pub fn new(file: &LogFile) -> Self {
        let text = normalize(&file.text);
        let breaks = text.match_indices('\n').map(|(i, _)| i).collect();
        Self { kind: file.kind.clone(), name: file.name.clone(), text, breaks }
    }

    pub fn start(&self, pos: usize) -> usize {
        self.text[..pos].rfind('\n').map_or(0, |i| i + 1)
    }

    pub fn line(&self, pos: usize) -> &str {
        let end = self.text[pos..].find('\n').map_or(self.text.len(), |i| pos + i);
        &self.text[self.start(pos)..end]
    }

    pub fn line_no(&self, pos: usize) -> usize {
        self.breaks.partition_point(|&b| b < pos) + 1
    }

    pub fn window(&self, pos: usize, size: usize) -> &str {
        let data = &self.text.as_bytes()[pos..];
        let mut end = size.min(data.len());
        while end < data.len() && data[end] & 0b1100_0000 == 0b1000_0000 {
            end += 1;
        }
        &self.text[pos..pos + end]
    }
}

pub fn value_text(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str)
}
