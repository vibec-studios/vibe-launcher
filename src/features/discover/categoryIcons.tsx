// Kategorie-Symbole (Modrinth-IDs bzw. CurseForge-Namen) als eigene, ruhige Lucide-Icons statt der SVG-Strings
// der API – einheitliche Strichstärke, keine fremde Markup-Einbettung.
import {
  Apple,
  Archive,
  AudioLines,
  Axe,
  Bolt,
  BookOpen,
  Box,
  Boxes,
  Brush,
  Cable,
  Castle,
  Cloud,
  Coins,
  Compass,
  Cpu,
  Feather,
  Flame,
  Flower2,
  Gamepad2,
  Gauge,
  Ghost,
  Grid3x3,
  Hammer,
  Languages,
  Layers,
  LayoutGrid,
  Leaf,
  Library,
  Lightbulb,
  Map as MapIcon,
  Moon,
  Mountain,
  Package,
  PawPrint,
  Pickaxe,
  Puzzle,
  ScrollText,
  Server,
  Shapes,
  Shield,
  Skull,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Sun,
  Swords,
  Tag,
  TrainFront,
  Trees,
  Type,
  Users,
  Wand2,
  Waves,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useLang } from "@/i18n";
import { prettyCategory } from "@/components/content/Pill";

const MAP: Record<string, LucideIcon> = {
  // Mods / Modpacks
  adventure: Compass,
  cursed: Skull,
  decoration: Flower2,
  economy: Coins,
  equipment: Shield,
  food: Apple,
  "game-mechanics": Bolt,
  library: Library,
  magic: Wand2,
  management: Server,
  minigame: Gamepad2,
  mobs: PawPrint,
  optimization: Zap,
  social: Users,
  storage: Archive,
  technology: Cpu,
  transportation: TrainFront,
  utility: Wrench,
  worldgen: Mountain,
  "kitchen-sink": Boxes,
  lightweight: Feather,
  multiplayer: Users,
  quests: ScrollText,
  challenging: Flame,
  combat: Swords,
  // Shader
  cartoon: Smile,
  fantasy: Castle,
  realistic: Sun,
  "semi-realistic": Cloud,
  "vanilla-like": Box,
  atmosphere: Cloud,
  bloom: Lightbulb,
  "colored-lighting": Lightbulb,
  foliage: Leaf,
  "path-tracing": Sparkles,
  pbr: Layers,
  reflections: Waves,
  shadows: Moon,
  potato: Gauge,
  low: Gauge,
  medium: Gauge,
  high: Gauge,
  screenshot: Sparkles,
  // Resourcepacks
  audio: AudioLines,
  blocks: Box,
  "core-shaders": Layers,
  entities: Ghost,
  environment: Trees,
  fonts: Type,
  gui: LayoutGrid,
  items: Pickaxe,
  locale: Languages,
  modded: Puzzle,
  models: Shapes,
  simplistic: Brush,
  themed: Brush,
  tweaks: SlidersHorizontal,
  "8x-": Grid3x3,
  "16x": Grid3x3,
  "32x": Grid3x3,
  "48x": Grid3x3,
  "64x": Grid3x3,
  "128x": Grid3x3,
  "256x": Grid3x3,
  "512x+": Grid3x3,
  // CurseForge (Namen, kleingeschrieben)
  "api and library": Library,
  "armor, tools, and weapons": Axe,
  "map and information": MapIcon,
  "world gen": Mountain,
  "server utility": Server,
  "redstone": Cable,
  "cosmetic": Sparkles,
  "miscellaneous": Package,
  "tinker's construct": Hammer,
  "education": BookOpen,
};

export function categoryIcon(id: string): LucideIcon {
  return MAP[id] ?? MAP[id.toLowerCase()] ?? Tag;
}

export function CategoryIcon({ id, size = 13, className }: { id: string; size?: number; className?: string }) {
  const I = categoryIcon(id);
  return <I size={size} strokeWidth={1.9} className={className} aria-hidden />;
}

const DE: Record<string, string> = {
  adventure: "Abenteuer", cursed: "Verflucht", decoration: "Dekoration", economy: "Wirtschaft", equipment: "Ausrüstung", food: "Essen",
  "game-mechanics": "Spielmechanik", library: "Bibliothek", magic: "Magie", management: "Verwaltung", minigame: "Minispiel", mobs: "Kreaturen",
  optimization: "Optimierung", social: "Soziales", storage: "Lagerung", technology: "Technik", transportation: "Transport", utility: "Werkzeuge",
  worldgen: "Weltgenerierung", "kitchen-sink": "Alles drin", lightweight: "Leichtgewicht", multiplayer: "Mehrspieler", quests: "Quests",
  challenging: "Herausfordernd", combat: "Kampf", cartoon: "Comic", fantasy: "Fantasy", realistic: "Realistisch", "semi-realistic": "Halbrealistisch",
  "vanilla-like": "Vanilla-nah", atmosphere: "Atmosphäre", bloom: "Bloom", "colored-lighting": "Farbiges Licht", foliage: "Blattwerk",
  "path-tracing": "Path Tracing", pbr: "PBR", reflections: "Spiegelungen", shadows: "Schatten", potato: "Kartoffel-PC", low: "Niedrig",
  medium: "Mittel", high: "Hoch", screenshot: "Screenshots", audio: "Audio", blocks: "Blöcke", "core-shaders": "Core-Shader", entities: "Wesen",
  environment: "Umgebung", fonts: "Schriften", gui: "Oberfläche", items: "Gegenstände", locale: "Sprache", modded: "Für Mods", models: "Modelle",
  simplistic: "Schlicht", themed: "Thematisch", tweaks: "Anpassungen",
};

/** Lesbarer Kategoriename in der UI-Sprache (Deutsch übersetzt, sonst Original). */
export function categoryLabel(id: string): string {
  if (useLang.getState().lang === "de" && DE[id]) return DE[id];
  return prettyCategory(id);
}

/** Ganze Zahl mit Tausendertrennzeichen in der UI-Sprache. */
export function fmtNum(n: number): string {
  return n.toLocaleString(useLang.getState().lang === "en" ? "en-US" : "de-DE");
}
