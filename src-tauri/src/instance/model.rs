use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct JavaOptions {
    /// Fester Java-Pfad für diese Instanz
    pub path: Option<String>,
    pub min_memory_mb: Option<u32>,
    pub max_memory_mb: Option<u32>,
    /// Zusätzliche JVM-Argumente (an die globalen angehängt)
    pub jvm_args: Option<String>,
    /// Umgebungsvariablen für den Spielprozess
    pub env: HashMap<String, String>,
    pub cds: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct WindowOptions {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fullscreen: Option<bool>,
}

/// Start-Hooks (siehe `minecraft::hooks`): Befehle vor dem Start / nach dem Beenden, Wrapper vor Java.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct LaunchHooks {
    /// Vor dem Start; Exit-Code ≠ 0 bricht den Start ab
    pub pre_launch: Option<String>,
    /// Nach dem Beenden des Spiels
    pub post_exit: Option<String>,
    /// Wrapper-Befehl vor Java (ersetzt den globalen)
    pub wrapper: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PackSourceKind {
    Modrinth,
    Curseforge,
    Vlpack,
    Prism,
    Local,
    /// Geteiltes Pack vom Vibe-Backend (`project_id` = Share-Code, `version_id` = Pack-Version)
    Vibe,
    Packwiz,
}

/// Herkunft einer Modpack-Instanz (für Updates/Anzeige).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackSource {
    pub kind: PackSourceKind,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub name: Option<String>,
    pub version_name: Option<String>,
}

/// Bedrock-Kanal: normale Version oder Preview (Beta).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "snake_case")]
pub enum BedrockChannel {
    #[default]
    Release,
    Preview,
}

impl BedrockChannel {
    pub fn as_str(&self) -> &'static str {
        match self {
            BedrockChannel::Release => "release",
            BedrockChannel::Preview => "preview",
        }
    }
}

/// Welche Spieldaten eine Bedrock-Instanz benutzt (siehe docs/BEDROCK.md).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BedrockProfile {
    /// Eigene Welten/Packs/Einstellungen; vor dem Start in den echten Ordner getauscht
    #[default]
    Isolated,
    /// Kein Tausch: direkt die normalen Bedrock-Daten des Nutzers
    Shared,
}

/// Einstellungen einer Bedrock-Instanz. `Instance::bedrock == Some(..)` heißt: Bedrock statt Java.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default)]
pub struct BedrockOptions {
    pub channel: BedrockChannel,
    pub profile: BedrockProfile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    pub name: String,
    /// Pfad zu einer Bilddatei (absolut), eingebautes Icon "builtin:<name>" oder Pixel-Block "block:<design>[@<hintergrund>]"
    pub icon: Option<String>,
    /// Akzentfarbe als Hex (#rrggbb), optional
    pub accent: Option<String>,
    pub group: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub java: JavaOptions,
    #[serde(default)]
    pub window: WindowOptions,
    #[serde(default)]
    pub hooks: LaunchHooks,
    #[serde(default)]
    pub source: Option<PackSource>,
    #[serde(default)]
    pub install_state: InstallState,
    /// ID der Versions-JSON, mit der zuletzt erfolgreich installiert wurde (z. B. "fabric-loader-0.16.9-1.21.1")
    #[serde(default)]
    pub version_id: Option<String>,
    pub created_at: i64,
    #[serde(default)]
    pub last_played: Option<i64>,
    #[serde(default)]
    pub play_time_secs: u64,
    #[serde(default)]
    pub notes: Option<String>,
    /// Inhalte vor dem Start automatisch aktualisieren: `None` = globale Einstellung
    /// (bei Modpack-Instanzen dann aus), `Some(..)` = explizit für diese Instanz
    #[serde(default)]
    pub auto_update_content: Option<bool>,
    /// Minecraft Bedrock statt Java (fehlt in älteren Dateien -> Java). Loader/Java/Fenster/Hooks
    /// werden bei Bedrock-Instanzen ignoriert, `mc_version` ist dann [`BEDROCK_VERSION`].
    #[serde(default)]
    pub bedrock: Option<BedrockOptions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_loader: Option<CustomLoaderRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CustomLoaderRef {
    pub id: String,
    pub version: String,
}

/// Platzhalter in `mc_version` von Bedrock-Instanzen (passt zu keiner Java-Version).
pub const BEDROCK_VERSION: &str = "bedrock";

impl Instance {
    pub fn is_bedrock(&self) -> bool {
        self.bedrock.is_some()
    }

    pub fn has_custom_loader(&self) -> bool {
        self.custom_loader.is_some()
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateInstance {
    pub name: String,
    pub mc_version: String,
    pub loader: Loader,
    pub icon: Option<String>,
    pub accent: Option<String>,
    pub group: Option<String>,
    #[serde(default)]
    pub custom_loader: Option<CustomLoaderRef>,
}

/// Teil-Update aus dem Frontend. Nur gesetzte Felder werden übernommen.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct InstancePatch {
    pub name: Option<String>,
    #[serde(deserialize_with = "double_option")]
    pub icon: Option<Option<String>>,
    #[serde(deserialize_with = "double_option")]
    pub accent: Option<Option<String>>,
    #[serde(deserialize_with = "double_option")]
    pub group: Option<Option<String>>,
    pub mc_version: Option<String>,
    pub loader: Option<Loader>,
    pub java: Option<JavaOptions>,
    pub window: Option<WindowOptions>,
    pub hooks: Option<LaunchHooks>,
    #[serde(deserialize_with = "double_option")]
    pub notes: Option<Option<String>>,
    #[serde(deserialize_with = "double_option")]
    pub auto_update_content: Option<Option<bool>>,
    /// Nur bei Bedrock-Instanzen wirksam (Kanal/Profil ändern)
    pub bedrock: Option<BedrockOptions>,
}

/// `null` -> `Some(None)` (Feld leeren), fehlendes Feld -> `None` (unverändert).
pub(super) fn double_option<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}
