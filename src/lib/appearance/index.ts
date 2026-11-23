// Darstellung anwenden: setzt Attribute/Variablen an <html> (siehe src/styles/globals.css) und merkt sich die
// letzten Werte in localStorage, damit schon der erste Frame richtig aussieht (applyCachedAppearance in main.tsx).
// Während das Einstellungs-Popup offen ist, zeigt `useAppearanceDraft` die ungespeicherte Vorschau.
//
// Themes sind Voreinstellungen: Sie setzen mehrere Werte (Akzent, Ton, Statusfarben …) auf einmal und schalten
// Extras frei (Winter: Schneefall, Maskottchen, Frost). Danach bleibt jeder Einzelwert frei anpassbar;
// „Zurücksetzen“ stellt die Werte des gewählten Themes wieder her.
export { NAV_KEYS, STATUS_DEFAULT, DEFAULT_APPEARANCE, ACCENT_PRESETS } from "./defaults";
export { THEMES, THEME_IDS } from "./themes";
export type { ThemeTokens, ThemeExtra, ThemeDef } from "./themes";
export { applyTheme, isThemeModified, isWinterSeason, effectiveAppearance, themeExtra } from "./themeUtils";
export { GRADIENTS, backgroundCss, hasBackground, isVideoFile } from "./background";
export { normalizeAppearance } from "./normalize";
export { useAppearanceDraft, useLiveAppearance, applyAppearance, applyPalette, cachedAppearance, applyCachedAppearance } from "./apply";
