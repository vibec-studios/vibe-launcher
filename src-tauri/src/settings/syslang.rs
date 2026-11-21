pub const LANGUAGES: [&str; 7] = ["de", "en", "es", "fr", "pl", "pt-BR", "tr"];

#[cfg(any(not(windows), test))]
pub fn from_tag(tag: &str) -> &'static str {
    let t = tag.trim().to_ascii_lowercase();
    match t.get(..2).unwrap_or("") {
        "de" => "de",
        "es" => "es",
        "fr" => "fr",
        "pl" => "pl",
        "pt" => "pt-BR",
        "tr" => "tr",
        _ => "en",
    }
}

pub fn from_langid(id: u16) -> &'static str {
    match id & 0x3ff {
        0x07 => "de",
        0x0a => "es",
        0x0c => "fr",
        0x15 => "pl",
        0x16 => "pt-BR",
        0x1f => "tr",
        _ => "en",
    }
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
        assert_eq!(from_tag("fr-FR"), "fr");
        assert_eq!(from_tag("pt_BR.UTF-8"), "pt-BR");
        assert_eq!(from_tag("tr"), "tr");
        assert_eq!(from_tag("ja-JP"), "en");
    }

    #[test]
    fn langids() {
        assert_eq!(from_langid(0x0407), "de");
        assert_eq!(from_langid(0x0807), "de");
        assert_eq!(from_langid(0x0c07), "de");
        assert_eq!(from_langid(0x0409), "en");
        assert_eq!(from_langid(0x040c), "fr");
        assert_eq!(from_langid(0x0c0a), "es");
        assert_eq!(from_langid(0x0415), "pl");
        assert_eq!(from_langid(0x0416), "pt-BR");
        assert_eq!(from_langid(0x041f), "tr");
        assert_eq!(from_langid(0x0411), "en");
    }
}
