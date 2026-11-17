// Sammelt die Installer-Artefakte für ein GitHub-Release und erzeugt die Tauri-Updater-`latest.json`.
//   node scripts/prepare-release.mjs --tag <release-tag> --version <version> [--notes "<text>"] [--out release-files]
// Erwartet den NSIS-Build in src-tauri/target/release/bundle/nsis (Installer + .sig).
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const repo = process.env.GITHUB_REPOSITORY || "vibec-studios/vibe-launcher";
const { tag, version } = args;
if (!tag || !version) throw new Error("--tag und --version sind Pflicht");
const out = args.out || "release-files";
const nsisDir = "src-tauri/target/release/bundle/nsis";

const installer = fs.readdirSync(nsisDir).find((f) => f.endsWith("-setup.exe") && f.includes(version));
if (!installer) throw new Error(`Kein Installer für ${version} in ${nsisDir}`);
const sigFile = path.join(nsisDir, installer + ".sig");
if (!fs.existsSync(sigFile)) throw new Error(`Signatur fehlt: ${sigFile} (TAURI_SIGNING_PRIVATE_KEY gesetzt?)`);

// Einheitlicher Dateiname ohne Leerzeichen (GitHub würde sie ohnehin umbenennen)
const assetName = `Vibe-Launcher_${version}_x64-setup.exe`;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(nsisDir, installer), path.join(out, assetName));
fs.copyFileSync(sigFile, path.join(out, assetName + ".sig"));

const latest = {
  version,
  notes: args.notes || "",
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: fs.readFileSync(sigFile, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${assetName}`,
    },
  },
};
fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(latest, null, 2));
console.log(`Bereit in ${out}/: ${assetName}, ${assetName}.sig, latest.json`);
