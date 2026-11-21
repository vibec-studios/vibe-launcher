import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function buildMock(outDir = path.join(os.tmpdir(), `vibe-visual-dist-${process.pid}`)) {
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`[visual] Mock-Build nach ${outDir}`);
  execFileSync("pnpm", ["exec", "vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, VITE_MOCK: "1" },
  });
  return outDir;
}
