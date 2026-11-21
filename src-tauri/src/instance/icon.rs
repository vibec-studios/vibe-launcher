use crate::error::{AppError, AppResult};

pub const BLOCK_PREFIX: &str = "block:";
const BUILTIN_PREFIX: &str = "builtin:";

pub fn is_generated(icon: &str) -> bool {
    icon.starts_with(BLOCK_PREFIX) || icon.starts_with(BUILTIN_PREFIX)
}

pub fn file_path(icon: Option<&str>) -> Option<&str> {
    icon.filter(|i| !is_generated(i))
}

fn token(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub fn valid_block(icon: &str) -> bool {
    let Some(rest) = icon.strip_prefix(BLOCK_PREFIX) else { return false };
    match rest.split_once('@') {
        Some((design, bg)) => token(design, 32) && token(bg, 16),
        None => token(rest, 32),
    }
}

pub fn check(icon: Option<&str>) -> AppResult<()> {
    match icon {
        Some(i) if i.starts_with(BLOCK_PREFIX) && !valid_block(i) => Err(AppError::Invalid("Ungültiges Block-Icon".into())),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_icons() {
        assert!(valid_block("block:grass"));
        assert!(valid_block("block:diamond@night"));
        assert!(!valid_block("block:"));
        assert!(!valid_block("block:Grass"));
        assert!(!valid_block("block:grass@"));
        assert!(!valid_block("block:../x"));
        assert!(!valid_block("block:a@b@c"));
        assert!(check(Some("block:x y")).is_err());
        assert!(check(Some(r"C:\icons\a.png")).is_ok());
        assert!(check(None).is_ok());
    }

    #[test]
    fn file_paths_skip_generated() {
        assert_eq!(file_path(Some("block:stone")), None);
        assert_eq!(file_path(Some("builtin:cube")), None);
        assert_eq!(file_path(Some("/tmp/icon.png")), Some("/tmp/icon.png"));
        assert_eq!(file_path(None), None);
    }
}
