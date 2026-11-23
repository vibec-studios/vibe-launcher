export const NAV_KEYS = [
    "home",
    "instances",
    "servers",
    "social",
    "discover",
    "skins",
    "screenshots"
];
export const STATUS_DEFAULT = {
    ok: "#3fe0c5",
    warn: "#ffb547",
    danger: "#ff5470"
};
export const DEFAULT_APPEARANCE = {
    design: "v1",
    theme: "standard",
    seasonal: false,
    accent: "#8b6cff",
    tone: "dark",
    radius: "square",
    radius_px: 6,
    density: "normal",
    ui_scale: 100,
    background: {
        kind: "none",
        gradient: "accent",
        animated: "aurora",
        image: null,
        video: null,
        dim: 45,
        blur: 0,
        color: "#1a1030",
        gradient_from: "#2b1655",
        gradient_to: "#ff9e6d",
        gradient_angle: 160
    },
    font: "inter",
    headings: "default",
    font_scale: 100,
    contrast: "normal",
    cards: "flat",
    glass: 0,
    sidebar: {
        mode: "compact",
        instances: true,
        order: NAV_KEYS,
        hidden: [],
        style: "solid"
    },
    icon_size: "large",
    library_view: "grid",
    status: STATUS_DEFAULT,
    motion: "normal",
    nav_animations: true,
    app_icon: "seal",
    app_icon_color: "#8b6cff",
    app_icon_image: null,
    effects: {
        snow: true,
        snow_amount: 50,
        snow_settle: true,
        mascot: true,
        frost: true
    },
    custom_themes: [],
    active_custom: null
};
export const ACCENT_PRESETS = [
    "#8b6cff",
    "#5aa9ff",
    "#3fe0c5",
    "#7ee07a",
    "#ffb547",
    "#ff7a45",
    "#ff6b9a",
    "#e05cff"
];
