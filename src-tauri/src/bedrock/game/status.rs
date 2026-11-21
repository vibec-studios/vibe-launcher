use super::*;

#[derive(Debug, Clone, Serialize)]
pub struct ChannelStatus {
    pub channel: BedrockChannel,
    pub installed: bool,
    pub version: Option<String>,
    pub layout: Option<Layout>,
    /// Echter Datenordner
    pub data_dir: Option<String>,
    /// Es gibt schon Bedrock-Daten (Welten/Packs), die übernommen werden können
    pub has_data: bool,
    /// Instanz, deren Profil gerade eingetauscht ist (oder deren Tausch offen ist)
    pub active_instance: Option<String>,
    pub running: bool,
    pub store_url: String,
    pub swap_locked: bool,
    pub same_volume: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    /// Windows
    pub supported: bool,
    /// Entwicklungsmodus mit Testordner (Spiel wird nur simuliert)
    pub simulated: bool,
    /// Warum Bedrock gerade nicht nutzbar ist (z. B. Debug-Sperre)
    pub blocked: Option<String>,
    pub channels: Vec<ChannelStatus>,
}

pub fn status(state: &AppState) -> Status {
    let supported = cfg!(windows) || super::super::simulated();
    let mut blocked = None;
    let mut channels = Vec::new();
    for ch in [BedrockChannel::Release, BedrockChannel::Preview] {
        let store_url = super::super::store_url(ch).to_string();
        match target(ch) {
            Ok(t) => {
                let inst = detect::install(ch);
                let sw = swapper(&state.paths, &t);
                // Billig: bricht bei der ersten Datei ab (Welten können viele GB groß sein)
                let has_data = sw.active_instance().is_none()
                    && t.layout.slots(&t.base).iter().any(|s| walkdir::WalkDir::new(super::super::slot_path(&t.base, s)).into_iter().flatten().any(|e| e.file_type().is_file()));
                channels.push(ChannelStatus {
                    channel: ch,
                    installed: inst.installed,
                    version: inst.version,
                    layout: Some(t.layout),
                    data_dir: Some(t.base.to_string_lossy().to_string()),
                    has_data,
                    active_instance: sw.active_instance(),
                    running: game_running(ch),
                    store_url,
                    swap_locked: super::super::issues::is_locked(ch),
                    same_volume: swap::check_same_volume(&state.paths.root, &t.base).is_ok(),
                });
            }
            Err(e) => {
                if supported {
                    blocked = Some(e.to_string());
                }
                channels.push(ChannelStatus { channel: ch, installed: false, version: None, layout: None, data_dir: None, has_data: false, active_instance: None, running: false, store_url, swap_locked: false, same_volume: true });
            }
        }
    }
    Status { supported, simulated: super::super::simulated(), blocked, channels }
}
