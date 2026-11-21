//! Microsoft-Login: Device-Code-Flow (MSA) -> Xbox Live -> XSTS -> Minecraft Services.
//!
//! Tokens werden nie geloggt; Fehlermeldungen enthalten nur Statuscodes und Fehlertexte der Server.
use crate::error::{AppError, AppResult};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

mod device;
mod errors;
mod xbox;
mod minecraft;

pub use device::*;
pub use errors::*;
pub use xbox::*;
pub use minecraft::*;

const MSA_BASE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
pub const MSA_SCOPE: &str = "XboxLive.signin offline_access";
const XBL_AUTH: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENTS: &str = "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

#[cfg(test)]
mod tests;
