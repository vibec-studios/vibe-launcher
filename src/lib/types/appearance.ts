export type UiMode = "simple" | "expert";

/** dark = Schwarz (Standard), dim = Dunkelgrau, oled = auch Flächen fast schwarz */
export type AppearanceTone = "dark" | "dim" | "oled" | "light";
export type AppearanceDesign = "v1" | "v2";
export type AppearanceRadius = "square" | "slight" | "round" | "custom";
export type AppearanceDensity = "compact" | "normal";
export type BackgroundKind = "none" | "color" | "gradient" | "image" | "animated";
export type BackgroundGradient = "accent" | "dusk" | "ocean" | "ember" | "forest" | "pixel" | "custom";
export type BackgroundAnimated = "aurora" | "particles" | "waves" | "blocks" | "custom";

/** Voreinstellungen, die mehrere Werte zugleich setzen (siehe THEMES in src/lib/appearance.ts) */
export type ThemeId =
  | "standard"
  | "winter"
  | "graphite"
  | "light"
  | "midnight"
  | "ocean"
  | "forest"
  | "sunset"
  | "sakura"
  | "nether"
  | "end"
  | "retro"
  | "contrast"
  | "pixel"
  | "pixel_light";
export type AppearanceFont = "inter" | "inter_tight" | "system" | "mono";
export type AppearanceHeadings = "default" | "pixel" | "pixel_all";
export type AppearanceContrast = "normal" | "high";
export type AppearanceCards = "flat" | "outlined" | "raised" | "pixel";
export type SidebarStyle = "solid" | "floating" | "tinted";

export interface ThemeValues {
  theme: ThemeId;
  accent: string;
  tone: AppearanceTone;
  radius: AppearanceRadius;
  radius_px: number;
  contrast: AppearanceContrast;
  cards: AppearanceCards;
  headings: AppearanceHeadings;
  font: AppearanceFont;
  font_scale: number;
  status: { ok: string; warn: string; danger: string };
  glass: number;
  sidebar_style: SidebarStyle;
  background: Omit<Appearance["background"], "image" | "video"> & { image?: string | null };
}

export interface CustomTheme {
  id: string;
  name: string;
  values: ThemeValues;
}
export type AppearanceMotion = "normal" | "more";
/** Einträge der Seitenleiste (Reihenfolge/Sichtbarkeit einstellbar) */
export type NavKey = "home" | "instances" | "servers" | "social" | "discover" | "skins" | "screenshots";

export interface Appearance {
  /** Design-Generation: v1 (Standard) oder v2 (Beta) */
  design: AppearanceDesign;
  /** Gewähltes Theme; die Einzelwerte bleiben danach frei anpassbar */
  theme: ThemeId;
  /** Im Dezember/Januar automatisch das Winter-Theme zeigen */
  seasonal: boolean;
  accent: string;
  tone: AppearanceTone;
  radius: AppearanceRadius;
  /** Eigener Eckenradius in px (0–24), wirkt bei radius = "custom" */
  radius_px: number;
  density: AppearanceDensity;
  /** Prozent, 80–130 */
  ui_scale: number;
  background: {
    kind: BackgroundKind;
    gradient: BackgroundGradient;
    animated: BackgroundAnimated;
    /** Eigenes Bild (Pfad im Datenordner) */
    image: string | null;
    /** Eigenes Video/GIF/WebP (Pfad im Datenordner) */
    video: string | null;
    /** Abdunklung 0–90 % */
    dim: number;
    /** Unschärfe 0–40 px */
    blur: number;
    /** Einfarbiger Hintergrund (kind = "color") */
    color: string;
    /** Eigener Verlauf (gradient = "custom") */
    gradient_from: string;
    gradient_to: string;
    gradient_angle: number;
  };
  /** Schrift für Fließtext */
  font: AppearanceFont;
  /** Überschriften: wie Fließtext oder Pixel-Schrift */
  headings: AppearanceHeadings;
  /** Schriftgröße in Prozent (90–115), unabhängig von der UI-Skalierung */
  font_scale: number;
  contrast: AppearanceContrast;
  /** Kartenstil: flach, mit Kante, erhaben oder Pixel-Kanten */
  cards: AppearanceCards;
  /** Glas-Effekt 0–100 (0 = aus): Flächen durchscheinend mit Unschärfe */
  glass: number;
  sidebar: {
    /** compact = nur Icons, wide = mit Beschriftung */
    mode: "compact" | "wide";
    /** Zuletzt gespielte Instanzen in der Seitenleiste */
    instances: boolean;
    order: NavKey[];
    hidden: NavKey[];
    /** solid = auf dem Rahmen, floating = eigene Platte, tinted = in Akzentfarbe getönt */
    style: SidebarStyle;
  };
  /** Instanz-Kacheln groß oder klein */
  icon_size: "large" | "small";
  /** Standardansicht der Bibliothek */
  library_view: "grid" | "list";
  /** Statusfarben (Hex) */
  status: { ok: string; warn: string; danger: string };
  /** „Mehr Animationen“ (Gegenstück zu „Animationen reduzieren“) */
  motion: AppearanceMotion;
  /** Übergang beim Seitenwechsel */
  nav_animations: boolean;
  /** App-Icon in Taskleiste, Fenster und Verknüpfungen */
  app_icon: "seal" | "penguin" | "custom";
  /** Kachelfarbe des App-Icons (Hex) */
  app_icon_color: string;
  /** Eigenes Bild fürs App-Icon (vom Launcher kopiert) */
  app_icon_image: string | null;
  /** Theme-Extras (wirken nur, wenn das Theme sie hat – z. B. Winter) */
  effects: {
    snow: boolean;
    /** Schneemenge 10–100 % */
    snow_amount: number;
    /** Ganz wenig Schnee sammelt sich auf Kanten */
    snow_settle: boolean;
    /** Theme-Maskottchen statt Logo in der Seitenleiste */
    mascot: boolean;
    /** Feine Frost-Details an Dialogkanten */
    frost: boolean;
  };
  /** Selbst gespeicherte Themes */
  custom_themes: CustomTheme[];
  /** Id des zuletzt angewendeten eigenen Themes */
  active_custom: string | null;
}
