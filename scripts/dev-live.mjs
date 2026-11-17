// Live-Entwicklung ohne HTTP-Dev-Server (lokale HTTP-Verbindungen aus WebView2 sind auf manchen Rechnern
// unzuverlässig):
//   1. `vite build --watch` baut das Frontend bei jeder Änderung nach dist/ (≈1–2 s)
//   2. die Debug-App lädt dist/ direkt von der Platte (eigenes Protokoll, siehe src-tauri/src/devlive.rs)
//      und lädt sich nach jedem Build automatisch neu – die Route bleibt erhalten
// Rust-Änderungen: Skript neu starten. Umgebungsvariablen (VIBE_LAUNCHER_HOME …) werden durchgereicht.
// Nutzung: node scripts/dev-live.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const dist = path.join(root, "dist");
const isWin = process.platform === "win32";
const env = { ...process.env, VIBE_DEV_DIST: dist };
const run = (cmd, args, cwd = root) => spawn(cmd, args, { cwd, stdio: "inherit", shell: isWin, env });

// Erst einmal bauen, damit die App sofort etwas anzeigen kann
fs.mkdirSync(dist, { recursive: true });
const watcher = run("pnpm", ["exec", "vite", "build", "--watch", "--mode", "development", "--emptyOutDir", "false"]);
const app = run("cargo", ["run", "--features", "tauri/custom-protocol"], path.join(root, "src-tauri"));
app.on("exit", (code) => {
  watcher.kill();
  process.exit(code ?? 0);
});
