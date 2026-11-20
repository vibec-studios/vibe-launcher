#[cfg(any(not(windows), test))]
pub fn from_tag(tag: &str) -> &'static str {
    if tag.trim().to_ascii_lowercase().starts_with("de") { "de" } else { "en" }
}

pub fn from_langid(id: u16) -> &'static str {
    if id & 0x3ff == 0x07 { "de" } else { "en" }
}

#[cfg(windows)]
pub fn system() -> &'static str {
    let id = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
    from_langid(id)
}

#[cfg(not(windows))]
pub fn system() -> &'static str {
    let tag = ["LC_ALL", "LC_MESSAGES", "LANG"].iter().find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty())).unwrap_or_default();
    if tag.is_empty() { "de" } else { from_tag(&tag) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags() {
        assert_eq!(from_tag("de-DE"), "de");
        assert_eq!(from_tag("de_AT.UTF-8"), "de");
        assert_eq!(from_tag("en-US"), "en");
        assert_eq!(from_tag("fr-FR"), "en");
    }

    #[test]
    fn langids() {
        assert_eq!(from_langid(0x0407), "de");
        assert_eq!(from_langid(0x0807), "de");
        assert_eq!(from_langid(0x0c07), "de");
        assert_eq!(from_langid(0x0409), "en");
        assert_eq!(from_langid(0x040c), "en");
    }
}
