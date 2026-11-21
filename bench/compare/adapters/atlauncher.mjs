import path from "node:path";
import fs from "node:fs";
import { download } from "../lib/fsutil.mjs";
import { startApp } from "../lib/proc.mjs";

const VERSION = "3.4.42.0";
const ASSET = `ATLauncher-${VERSION}.jar`;

export const atlauncher = {
  id: "atlauncher",
  name: "ATLauncher",
  version: VERSION,
  source: `https://github.com/ATLauncher/ATLauncher/releases/tag/v${VERSION}`,
  automation: { idle: true, install: false, launch: false },
  mainWindow: /ATLauncher/i,
  notes: [
    "Läuft mit derselben Temurin-JRE wie die Spielstarts (javaw -jar), Datenordner per --working-dir.",
    "Modpack-Import (.mrpack) und Spielstart sind in ATLauncher nur über die Oberfläche möglich – noch nicht automatisiert.",
  ],

  async prepare(ctx) {
    const url = `https://github.com/ATLauncher/ATLauncher/releases/download/v${VERSION}/${ASSET}`;
    const dir = path.join(ctx.l.apps, "atlauncher");
    const dl = await download(url, dir, ASSET);
    return { download: dl, appDir: dir, exe: ASSET };
  },

  async seed(ctx, dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
  },

  start(ctx, dataDir) {
    const args = ["-jar", path.join(ctx.app.appDir, ctx.app.exe), "--working-dir", dataDir, "--no-launcher-update", "--skip-setup-dialog", "--skip-tray-integration", "--disable-analytics", "--disable-error-reporting", "--no-console"];
    const app = startApp(ctx.javaw, args, { cwd: dataDir });
    app.dataDir = dataDir;
    return app;
  },
};
