use super::*;

#[derive(Debug, Deserialize)]
pub struct RawProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<RawTexture>,
    #[serde(default)]
    pub capes: Vec<RawTexture>,
}

#[derive(Debug, Deserialize)]
pub struct RawTexture {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub alias: Option<String>,
}

impl RawProfile {
    pub fn active_skin(&self) -> Option<&RawTexture> {
        self.skins.iter().find(|s| s.state.eq_ignore_ascii_case("active")).or(self.skins.first())
    }
}
