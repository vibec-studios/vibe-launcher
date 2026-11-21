use super::*;

/// Wo das Spiel eines Kanals seine Daten hat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub channel: BedrockChannel,
    pub base: PathBuf,
    pub layout: Layout,
}

impl Target {
    pub fn packs_dir(&self) -> PathBuf {
        slot_path(&self.base, &self.layout.packs_slot())
    }
}

/// Paketfamilien (für Registry-Suche und Store-Links).
pub fn package_family(channel: BedrockChannel) -> &'static str {
    match channel {
        BedrockChannel::Release => "Microsoft.MinecraftUWP_8wekyb3d8bbwe",
        BedrockChannel::Preview => "Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe",
    }
}

/// Store-Seite zum Installieren.
pub fn store_url(channel: BedrockChannel) -> &'static str {
    match channel {
        BedrockChannel::Release => "ms-windows-store://pdp/?productid=9NBLGGH2JHXJ",
        BedrockChannel::Preview => "ms-windows-store://search/?query=Minecraft%20Preview",
    }
}

pub(super) fn gdk_dir_name(channel: BedrockChannel) -> &'static str {
    match channel {
        BedrockChannel::Release => "Minecraft Bedrock",
        BedrockChannel::Preview => "Minecraft Bedrock Preview",
    }
}

/// Test-/Entwicklungsordner statt echter Pfade (nur Debug-Builds).
pub fn dev_root() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        std::env::var_os("VIBE_BEDROCK_ROOT").filter(|v| !v.is_empty()).map(PathBuf::from)
    } else {
        None
    }
}

/// Dürfen echte Bedrock-Daten angefasst werden? (Release immer; Debug nur mit `VIBE_BEDROCK_REAL=1`)
pub fn real_allowed() -> bool {
    !cfg!(debug_assertions) || std::env::var_os("VIBE_BEDROCK_REAL").is_some()
}

/// Spiel nur simulieren (Debug mit `VIBE_BEDROCK_ROOT`).
pub fn simulated() -> bool {
    dev_root().is_some()
}

/// GDK- und UWP-Basisordner eines Kanals unter einem `%AppData%`/`%LocalAppData%`-Paar.
pub(super) fn bases(roaming: &Path, local: &Path, channel: BedrockChannel) -> (PathBuf, PathBuf) {
    (
        roaming.join(gdk_dir_name(channel)),
        local.join("Packages").join(package_family(channel)).join("LocalState"),
    )
}

/// Layout wählen: GDK, sobald dessen Ordner existiert oder es keine alten UWP-Daten gibt.
pub fn choose(channel: BedrockChannel, gdk: PathBuf, uwp: PathBuf) -> Target {
    if !gdk.exists() && uwp.join("games").join("com.mojang").is_dir() {
        Target { channel, base: uwp, layout: Layout::Uwp }
    } else {
        Target { channel, base: gdk, layout: Layout::Gdk }
    }
}

/// Echte (bzw. Test-)Datenorte eines Kanals.
pub fn target(channel: BedrockChannel) -> AppResult<Target> {
    if let Some(root) = dev_root() {
        let (g, u) = bases(&root, &root, channel);
        return Ok(choose(channel, g, u));
    }
    if !real_allowed() {
        return Err(AppError::NotConfigured(
            "Entwicklungs-Build: echte Bedrock-Daten sind gesperrt. VIBE_BEDROCK_ROOT (Testordner) oder VIBE_BEDROCK_REAL=1 setzen.".into(),
        ));
    }
    if !cfg!(windows) {
        return Err(AppError::Invalid("Minecraft Bedrock gibt es nur unter Windows.".into()));
    }
    let roaming = dirs::data_dir().ok_or_else(|| AppError::msg("%AppData% nicht gefunden"))?;
    let local = dirs::data_local_dir().ok_or_else(|| AppError::msg("%LocalAppData% nicht gefunden"))?;
    let (g, u) = bases(&roaming, &local, channel);
    Ok(choose(channel, g, u))
}
