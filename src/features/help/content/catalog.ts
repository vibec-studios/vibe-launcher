import type { GuideDef, TourDef } from "../types";

const INSTANCE = "/instances/{recent}";

export const GUIDES: GuideDef[] = [
  { id: "first-instance", icon: "plus", tour: "first-instance" },
  { id: "modpack", icon: "package", tour: "modpack" },
  { id: "mods", icon: "boxes", tour: "mods" },
  { id: "import", icon: "import", tour: "import" },
  { id: "autofix", icon: "wrench", tour: "autofix" },
  { id: "backups", icon: "archive", tour: "backups" },
  { id: "hosting", icon: "globe", tour: "hosting" },
  { id: "servers", icon: "server", tour: "servers" },
  { id: "skins", icon: "shirt", tour: "skins" },
  { id: "modsets", icon: "layers", tour: "modsets" },
  { id: "gallery", icon: "images", tour: "gallery" },
  { id: "waitlist", icon: "cloud", tour: "waitlist" },
  { id: "bedrock", icon: "cube" },
  { id: "feedback", icon: "message", tour: "feedback" },
  { id: "performance", icon: "gauge", tour: "performance" },
];

export const TOURS: TourDef[] = [
  {
    id: "intro",
    steps: [
      { targets: ["play", "new-game", "new-instance"], route: "/" },
      { targets: ["instances"] },
      { targets: ["discover"] },
      { targets: ["account"] },
      { targets: ["help"] },
    ],
  },
  {
    id: "first-instance",
    guide: "first-instance",
    steps: [
      { targets: ["new-instance"], route: "/" },
      { targets: ["instances-new"], route: "/instances" },
      { targets: ["instances-import"], optional: true },
      { targets: ["instances"] },
    ],
  },
  {
    id: "modpack",
    guide: "modpack",
    steps: [
      { targets: ["discover"], route: "/discover?type=modpack" },
      { targets: ["discover-types"] },
      { targets: ["discover-search"] },
      { targets: ["discover-results"] },
    ],
  },
  {
    id: "mods",
    guide: "mods",
    steps: [
      { targets: ["content-add"], route: `${INSTANCE}?tab=content` },
      { targets: ["content-add-files"], optional: true },
      { targets: ["content-update", "content-refresh"] },
      { targets: ["content-list"], optional: true },
    ],
  },
  {
    id: "import",
    guide: "import",
    steps: [
      { targets: ["instances-import"], route: "/instances" },
      { targets: ["import-mode"], open: "import:launcher" },
      { targets: ["import-body"], open: "import:launcher" },
      { targets: ["instances-import"] },
    ],
  },
  {
    id: "autofix",
    guide: "autofix",
    steps: [
      { targets: ["crash-banner", "autofix", "logs-diagnose"], route: `${INSTANCE}?tab=logs` },
      { targets: ["instance-play"] },
      { targets: ["feedback"] },
    ],
  },
  {
    id: "backups",
    guide: "backups",
    steps: [
      { targets: ["backups-create"], route: `${INSTANCE}?tab=backups` },
      { targets: ["backups-list"], optional: true },
      { targets: ["settings-backups"], open: "settings:game" },
    ],
  },
  {
    id: "hosting",
    guide: "hosting",
    steps: [
      { targets: ["worlds-list"], route: `${INSTANCE}?tab=worlds` },
      { targets: ["play-link"], optional: true },
      { targets: ["social"], optional: true },
      { targets: ["servers-new"], route: "/servers" },
    ],
  },
  {
    id: "servers",
    guide: "servers",
    steps: [
      { targets: ["servers-new"], route: "/servers" },
      { targets: ["servers-list"], optional: true },
      { targets: ["servers"] },
    ],
  },
  {
    id: "skins",
    guide: "skins",
    steps: [
      { targets: ["skins-viewer"], route: "/skins" },
      { targets: ["skins-library"] },
      { targets: ["cosmetics"], optional: true },
    ],
  },
  {
    id: "modsets",
    guide: "modsets",
    steps: [
      { targets: ["modsets-new"], route: "/modsets" },
      { targets: ["modsets-import"] },
      { targets: ["modsets-list"], optional: true },
    ],
  },
  {
    id: "gallery",
    guide: "gallery",
    steps: [
      { targets: ["gallery-switch"], route: "/screenshots" },
      { targets: ["gallery-filter"], optional: true },
      { targets: ["gallery-grid"], optional: true },
    ],
  },
  {
    id: "waitlist",
    guide: "waitlist",
    steps: [
      { targets: ["settings-tab-vibe"], open: "settings:vibe" },
      { targets: ["vibe-access", "settings-content"], open: "settings:vibe" },
    ],
  },
  {
    id: "feedback",
    guide: "feedback",
    steps: [
      { targets: ["feedback"] },
      { targets: ["help"] },
    ],
  },
  {
    id: "performance",
    guide: "performance",
    steps: [
      { targets: ["instance-settings"], route: `${INSTANCE}?tab=content` },
      { targets: ["instance-perf"], open: "instance-settings:perf" },
      { targets: ["ram"], open: "settings:java", optional: true },
    ],
  },
];

export const tourById = (id: string) => TOURS.find((t) => t.id === id);
export const guideById = (id: string) => GUIDES.find((g) => g.id === id);
