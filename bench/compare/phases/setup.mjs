import path from "node:path";
import fs from "node:fs";
import { download, extractZip, dirSize, writeJson } from "../lib/fsutil.mjs";
import { readIndex, makeVanillaPack } from "../lib/mrpack.mjs";

export async function setup(ctx, launchers) {
  const { l, pins, log } = ctx;
  log("Java (gemeinsam für alle Spielstarts) …");
  const jdl = await download(pins.java.url, path.join(l.downloads, "java"), "jre.zip", { sha256: pins.java.sha256 });
  const jdir = path.join(l.shared, "java");
  if (!fs.existsSync(path.join(jdir, "bin", "javaw.exe"))) {
    const tmp = path.join(l.shared, "java-extract");
    await extractZip(jdl.file, tmp);
    const inner = fs.readdirSync(tmp).find((d) => fs.existsSync(path.join(tmp, d, "bin", "javaw.exe")));
    fs.rmSync(jdir, { recursive: true, force: true });
    fs.renameSync(path.join(tmp, inner), jdir);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  log("Modpack (.mrpack) …");
  const pdl = await download(pins.modpack.url, path.join(l.downloads, "modpack"), "pack.mrpack", { sha512: pins.modpack.sha512 });
  const index = await readIndex(pdl.file, path.join(l.work, "tmp-index"));
  const vanilla = await makeVanillaPack(path.join(l.shared, "bench-vanilla.mrpack"), pins.mcVersion, path.join(l.work, "tmp-vanilla"));

  const state = {
    at: new Date().toISOString(),
    java: { ...pins.java, javaw: path.join(jdir, "bin", "javaw.exe"), size: jdl.size },
    modpack: { ...pins.modpack, file: pdl.file, index },
    vanillaPack: vanilla,
    apps: { ...(ctx.state.apps ?? {}) },
  };
  const result = { phase: "setup", launchers: {} };
  for (const a of launchers) {
    log(`${a.name} ${a.version} herunterladen und entpacken …`);
    const info = await a.prepare({ ...ctx, ...{ javaw: state.java.javaw } });
    const size = await dirSize(info.appDir);
    state.apps[a.id] = info;
    result.launchers[a.id] = {
      name: a.name,
      version: a.version,
      source: a.source,
      download: { url: info.download.url, bytes: info.download.size, sha256: info.download.sha256 },
      installBytes: size.bytes,
      installFiles: size.files,
      notes: a.id === "vibe" ? ["Nutzt die WebView2-Laufzeit von Windows (nicht mitgezählt)."] : a.id === "atlauncher" ? ["Braucht eine Java-Laufzeit (nicht mitgezählt)."] : ["Qt-Laufzeit im Paket enthalten."],
    };
    log(`  ${a.name}: ${(size.bytes / 2 ** 20).toFixed(1)} MiB in ${size.files} Dateien`);
  }
  await writeJson(l.state, state);
  return result;
}
