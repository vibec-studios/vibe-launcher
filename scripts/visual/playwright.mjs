import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const PLAYWRIGHT_VERSION = "1.65.1";

function cacheDir() {
  if (process.env.VIBE_VISUAL_CACHE) return process.env.VIBE_VISUAL_CACHE;
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".cache");
  return path.join(base, "vibe-visual", `playwright-${PLAYWRIGHT_VERSION}`);
}

function tryResolve(from) {
  try {
    const entry = createRequire(from).resolve("playwright-core");
    const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), "package.json"), "utf8"));
    return meta.version === PLAYWRIGHT_VERSION ? entry : null;
  } catch {
    return null;
  }
}

function ensureInstalled() {
  const dir = cacheDir();
  const pkg = path.join(dir, "package.json");
  const hit = tryResolve(pkg);
  if (hit) return hit;
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({ name: "vibe-visual-cache", private: true }));
  console.log(`[visual] installiere playwright-core@${PLAYWRIGHT_VERSION} nach ${dir}`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npm, ["install", "--no-audit", "--no-fund", "--loglevel=error", `playwright-core@${PLAYWRIGHT_VERSION}`], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
  const resolved = tryResolve(pkg);
  if (!resolved) throw new Error("playwright-core konnte nicht installiert werden");
  return resolved;
}

function ensureBrowser(entry) {
  const cli = path.join(path.dirname(entry), "cli.js");
  execFileSync(process.execPath, [cli, "install", "chromium-headless-shell"], { stdio: "inherit" });
}

const LAUNCH = {
  headless: true,
  args: [
    "--font-render-hinting=none",
    "--disable-font-subpixel-positioning",
    "--disable-lcd-text",
    "--disable-skia-runtime-opts",
    "--force-color-profile=srgb",
    "--force-device-scale-factor=1",
    "--disable-gpu",
    "--disable-partial-raster",
    "--num-raster-threads=1",
  ],
};

export async function loadChromium() {
  const entry = tryResolve(path.join(process.cwd(), "package.json")) ?? ensureInstalled();
  const pw = await import(pathToFileURL(entry).href);
  const chromium = pw.chromium ?? pw.default.chromium;
  try {
    return await chromium.launch(LAUNCH);
  } catch (e) {
    if (!String(e?.message ?? e).includes("Executable doesn't exist")) throw e;
    ensureBrowser(entry);
    return chromium.launch(LAUNCH);
  }
}
