//! Bilder für den Discord-Status: großes Bild (Logo, App-Icon, Spielerkopf, eigenes Bild, optional Modpack-Icon)
//! und kleines Bild (Spielerkopf, Loader, nichts). Rein und testbar; Vertrag in docs/DISCORD.md.
use super::app_icon::IconSpec;
use super::discord::ASSET_LOGO;
use crate::settings::Settings;
use std::path::PathBuf;

pub const LARGE: &[&str] = &["logo", "app_icon", "head", "custom"];
pub const SMALL: &[&str] = &["head", "loader", "none"];
pub const ASSET_SEAL: &str = "seal";
pub const ASSET_PENGUIN: &str = "penguin";

#[derive(Debug, Clone, PartialEq)]
pub struct Head {
    pub uuid: String,
    pub name: String,
}

impl Head {
    pub fn new(uuid: &str, name: &str) -> Option<Head> {
        let uuid = uuid.replace('-', "").to_ascii_lowercase();
        let ok = uuid.len() == 32 && uuid.bytes().all(|b| b.is_ascii_hexdigit()) && !name.trim().is_empty();
        ok.then(|| Head { uuid, name: name.trim().to_string() })
    }

    pub fn url(&self, size: u32) -> String {
        format!("https://mc-heads.net/avatar/{}/{size}", self.uuid)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Large {
    Logo,
    AppIcon,
    Head,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Small {
    Head,
    Loader,
    None,
}

#[derive(Debug, Clone)]
pub struct Art {
    pub large: Large,
    pub pack_icon: bool,
    pub small: Small,
    pub app_icon: IconSpec,
    pub custom: Option<PathBuf>,
}

impl Default for Art {
    fn default() -> Self {
        Art { large: Large::Logo, pack_icon: true, small: Small::Head, app_icon: IconSpec::new("seal", "", None), custom: None }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Picked {
    pub large: Option<String>,
    pub small: Option<(String, String)>,
}

pub fn hosted_url(_spec: &IconSpec) -> Option<String> {
    None
}

impl Art {
    pub fn from_settings(s: &Settings) -> Art {
        let large = match s.discord_large.as_str() {
            "app_icon" => Large::AppIcon,
            "head" => Large::Head,
            "custom" => Large::Custom,
            _ => Large::Logo,
        };
        let small = match s.discord_small.as_str() {
            "loader" => Small::Loader,
            "none" => Small::None,
            _ => Small::Head,
        };
        Art {
            large,
            pack_icon: s.discord_pack_icon,
            small,
            app_icon: IconSpec::from_appearance(&s.appearance),
            custom: s.discord_image.as_deref().filter(|p| !p.is_empty()).map(PathBuf::from),
        }
    }

    fn app_icon_image(&self) -> String {
        let fallback = if self.app_icon.motif == "penguin" { ASSET_PENGUIN } else { ASSET_SEAL };
        if self.app_icon.motif != "custom" && self.app_icon.has_default_color() {
            return fallback.into();
        }
        hosted_url(&self.app_icon).unwrap_or_else(|| fallback.into())
    }

    fn custom_image(&self) -> String {
        let spec = IconSpec { motif: "custom".into(), image: self.custom.clone(), ..self.app_icon.clone() };
        self.custom.as_ref().and_then(|_| hosted_url(&spec)).unwrap_or_else(|| ASSET_LOGO.into())
    }

    fn main_image(&self, head: Option<&Head>) -> (String, bool) {
        match (self.large, head) {
            (Large::Head, Some(h)) => (h.url(256), true),
            (Large::AppIcon, _) => (self.app_icon_image(), false),
            (Large::Custom, _) => (self.custom_image(), false),
            _ => (ASSET_LOGO.into(), false),
        }
    }

    pub fn pick(&self, pack_icon: Option<&str>, loader: Option<&(String, String)>, head: Option<&Head>) -> Picked {
        let pack = pack_icon.filter(|_| self.pack_icon).map(str::to_string);
        let (main, main_is_head) = self.main_image(head);
        let head_free = pack.is_some() || !main_is_head;
        let head_small = head.filter(|_| self.small == Small::Head && head_free).map(|h| (h.url(128), h.name.clone()));
        let loader_small = loader.filter(|_| self.small != Small::None).cloned();
        Picked { large: Some(pack.unwrap_or(main)), small: head_small.or(loader_small) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

    fn head() -> Head {
        Head::new(UUID, "Notch").unwrap()
    }
    fn fabric() -> (String, String) {
        ("fabric".into(), "Fabric · Minecraft 1.21.1".into())
    }

    #[test]
    fn head_url() {
        let h = head();
        assert_eq!(h.url(128), "https://mc-heads.net/avatar/069a79f444e94726a5befca90e38aaf5/128");
        assert!(Head::new("kein-uuid", "Notch").is_none());
        assert!(Head::new(UUID, " ").is_none());
    }

    #[test]
    fn small_defaults_to_head() {
        let p = Art::default().pick(None, Some(&fabric()), Some(&head()));
        assert_eq!(p.large.as_deref(), Some(ASSET_LOGO));
        assert_eq!(p.small, Some((head().url(128), "Notch".into())));
    }

    #[test]
    fn small_fallbacks() {
        let art = Art::default();
        assert_eq!(art.pick(None, Some(&fabric()), None).small, Some(fabric()));
        assert_eq!(art.pick(None, None, None).small, None);
        let loader = Art { small: Small::Loader, ..Art::default() };
        assert_eq!(loader.pick(None, Some(&fabric()), Some(&head())).small, Some(fabric()));
        assert_eq!(loader.pick(None, None, Some(&head())).small, None);
        let none = Art { small: Small::None, ..Art::default() };
        assert_eq!(none.pick(None, Some(&fabric()), Some(&head())).small, None);
    }

    #[test]
    fn large_choices() {
        let pack = "https://cdn.modrinth.com/x.png";
        let art = |large| Art { large, pack_icon: false, ..Art::default() };
        assert_eq!(art(Large::Logo).pick(Some(pack), None, None).large.as_deref(), Some(ASSET_LOGO));
        assert_eq!(art(Large::AppIcon).pick(None, None, None).large.as_deref(), Some(ASSET_SEAL));
        assert_eq!(art(Large::Custom).pick(None, None, None).large.as_deref(), Some(ASSET_LOGO));
        let auto = Art { large: Large::AppIcon, ..Art::default() };
        assert_eq!(auto.pick(Some(pack), None, None).large.as_deref(), Some(pack));
        assert_eq!(auto.pick(None, None, None).large.as_deref(), Some(ASSET_SEAL));
    }

    #[test]
    fn app_icon_falls_back_to_default_asset() {
        let with = |motif: &str, color: &str| Art { large: Large::AppIcon, app_icon: IconSpec::new(motif, color, None), ..Art::default() };
        assert_eq!(with("penguin", super::super::app_icon::DEFAULT_COLOR).pick(None, None, None).large.as_deref(), Some(ASSET_PENGUIN));
        assert_eq!(with("penguin", "#22aa66").pick(None, None, None).large.as_deref(), Some(ASSET_PENGUIN));
        assert_eq!(with("seal", "#22aa66").pick(None, None, None).large.as_deref(), Some(ASSET_SEAL));
        assert_eq!(with("custom", "#22aa66").pick(None, None, None).large.as_deref(), Some(ASSET_SEAL));
    }

    #[test]
    fn head_as_large_image() {
        let art = Art { large: Large::Head, ..Art::default() };
        let p = art.pick(None, Some(&fabric()), Some(&head()));
        assert_eq!(p.large, Some(head().url(256)));
        assert_eq!(p.small, Some(fabric()));
        let p = art.pick(Some("https://cdn.modrinth.com/x.png"), Some(&fabric()), Some(&head()));
        assert_eq!(p.small.map(|s| s.1), Some("Notch".to_string()));
        assert_eq!(art.pick(None, None, None).large.as_deref(), Some(ASSET_LOGO));
    }
}
