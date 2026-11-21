use super::*;

pub fn known_area(a: &str) -> bool {
    CATEGORIES.contains(&a) || AREAS.contains(&a)
}

pub(super) const CONTROLS: &[&str] = &[
    "mouseSensitivity",
    "invertYMouse",
    "autoJump",
    "toggleCrouch",
    "toggleSprint",
    "rawMouseInput",
    "discrete_mouse_scroll",
    "mouseWheelSensitivity",
    "operatorItemsTab",
];
pub(super) const SOUND: &[&str] = &["showSubtitles", "directionalAudio", "soundDevice"];
pub(super) const VIDEO: &[&str] = &[
    "renderDistance",
    "simulationDistance",
    "graphicsMode",
    "fancyGraphics",
    "guiScale",
    "maxFps",
    "enableVsync",
    "fov",
    "gamma",
    "entityShadows",
    "particles",
    "renderClouds",
    "biomeBlendRadius",
    "ao",
    "mipmapLevels",
    "bobView",
    "fovEffectScale",
    "screenEffectScale",
    "entityDistanceScaling",
    "prioritizeChunkUpdates",
    "menuBackgroundBlurriness",
    "darknessEffectScale",
    "glintSpeed",
    "glintStrength",
    "attackIndicator",
    "chunkSectionFadeInTime",
];
pub(super) const LANGUAGE: &[&str] = &["lang", "forceUnicodeFont"];
pub(super) const ACCESSIBILITY: &[&str] = &[
    "narrator",
    "highContrast",
    "highContrastBlockOutline",
    "darkMojangStudiosBackground",
    "hideLightningFlashes",
    "chatOpacity",
    "textBackgroundOpacity",
    "backgroundForChatOnly",
    "chatScale",
    "chatWidth",
    "chatLineSpacing",
    "chatDelay",
    "notificationDisplayTime",
    "panoramaScrollSpeed",
    "damageTiltStrength",
    "narratorHotkey",
    "onboardAccessibility",
    "reducedDebugInfo",
    "showAutosaveIndicator",
];
/// OptiFine-Schlüssel, die vom Bildschirm abhängen und deshalb nicht übertragen werden.
pub(super) const OPTIFINE_SKIP: &[&str] = &["ofFullscreenMode"];

/// Kategorie eines Schlüssels (None = wird nie synchronisiert).
pub fn category_of(key: &str) -> Option<&'static str> {
    if key.starts_with("key_") {
        return Some("keybinds");
    }
    if key.starts_with("soundCategory_") {
        return Some("sound");
    }
    for (cat, list) in [
        ("controls", CONTROLS),
        ("sound", SOUND),
        ("video", VIDEO),
        ("language", LANGUAGE),
        ("accessibility", ACCESSIBILITY),
    ] {
        if list.contains(&key) {
            return Some(cat);
        }
    }
    None
}
