use super::Settings;
use crate::platform::presence_art::{LARGE, SMALL};
use std::path::Path;

impl Settings {
    pub fn sanitize_discord(&mut self, icon_dir: &Path) {
        let d = Settings::default();
        if !LARGE.contains(&self.discord_large.as_str()) {
            self.discord_large = d.discord_large;
        }
        if !SMALL.contains(&self.discord_small.as_str()) {
            self.discord_small = d.discord_small;
        }
        if self.discord_image.as_deref().is_some_and(|p| !Path::new(p).starts_with(icon_dir)) {
            self.discord_image = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discord_defaults_and_sanitize() {
        let mut s: Settings = serde_json::from_str(r#"{"language":"de","discord_rpc":true}"#).unwrap();
        assert_eq!((s.discord_large.as_str(), s.discord_small.as_str()), ("logo", "head"));
        assert!(s.discord_pack_icon);
        s.discord_large = "quatsch".into();
        s.discord_small = "".into();
        s.discord_image = Some("C:/fremd/bild.png".into());
        s.sanitize_discord(Path::new("C:/daten/app-icon"));
        assert_eq!((s.discord_large.as_str(), s.discord_small.as_str()), ("logo", "head"));
        assert!(s.discord_image.is_none());
    }
}
