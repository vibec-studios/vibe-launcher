import { fakeTask, type Handlers } from "./util";

const MB = 1024 * 1024;
const GB = 1024 * MB;

const cleaned = new Set<string>();

const cat = (id: string, bytes: number, cleanable = 0) => ({ id, bytes: cleaned.has(id) ? bytes - cleanable : bytes, cleanable: cleaned.has(id) ? 0 : cleanable });

const folder = (name: string, bytes: number, kind: string) => ({ name, bytes, kind });

const usage = () => ({
  root: "C:\\Users\\Steve\\AppData\\Roaming\\VibeLauncher",
  total: 18.4 * GB,
  shared_saved: 2.1 * GB,
  free: 212 * GB,
  categories: [
    cat("instances", 9.6 * GB),
    cat("mod_caches", 640 * MB, 512 * MB),
    cat("instance_logs", 180 * MB, 120 * MB),
    cat("world_backups", 2.4 * GB),
    cat("orphan_world_backups", 0),
    cat("snapshots", 820 * MB, 96 * MB),
    cat("game_files", 2.9 * GB),
    cat("java", 1.1 * GB),
    cat("servers", 640 * MB),
    cat("store", 1.3 * GB),
    cat("cache", 410 * MB, 380 * MB),
    cat("launcher_logs", 24 * MB, 18 * MB),
    cat("vibey", 46 * MB, 46 * MB),
    cat("other", 12 * MB),
    cat("webview", 96 * MB),
  ],
  instances: [
    {
      id: "survival",
      name: "Survival",
      bytes: 4.2 * GB,
      shared: 1.1 * GB,
      running: false,
      folders: [
        folder("saves", 2.6 * GB, "worlds"),
        folder("mods", 820 * MB, "mods"),
        folder(".bobby", 410 * MB, "rebuild"),
        folder(".fabric", 220 * MB, "cache"),
        folder("config", 18 * MB, "config"),
        folder(".vibe-launcher", 2 * MB, "launcher"),
      ],
    },
    {
      id: "creative",
      name: "Kreativ",
      bytes: 1.8 * GB,
      shared: 640 * MB,
      running: true,
      folders: [folder("mods", 1.1 * GB, "mods"), folder("saves", 610 * MB, "worlds"), folder("logs", 40 * MB, "logs")],
    },
  ],
});

export default {
  storage_usage: () => usage(),
  storage_clean: ({ category }) => {
    const c = usage().categories.find((x) => x.id === category);
    cleaned.add(String(category));
    return c?.cleanable ?? 0;
  },
  storage_dedup: () => fakeTask("storage", "Platz sparen", null, 2000),
} satisfies Handlers;
