mod manifest;
mod runtime;
mod store;
mod update;
#[cfg(test)]
mod tests;

pub use manifest::*;
pub use runtime::*;
pub use store::*;
pub use update::*;

pub const MANIFEST_URL: &str = "https://github.com/vibec-studios/vibe-launcher/releases/download/vibefix-model/manifest.json";
pub const PUBLIC_KEY: &str = "enmE9uuX+YteYQDsRuapFB2jvjb5pfYR45nJaZAp3vw=";
pub const STATUS_EVENT: &str = "vibefix://status";
