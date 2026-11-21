// Sammelt die Installer-Artefakte aller Plattformen für ein GitHub-Release und erzeugt die
// Tauri-Updater-`latest.json` (alle Plattformen in einer Datei).
//   node scripts/prepare-release.mjs --tag <release-tag> --version <version> [--notes "<text>"]
//                                    [--from <ordner>] [--out release-files] [--require windows,linux,macos]
// `--from` wird rekursiv durchsucht (Standard: src-tauri/target – also der lokale Build). In der CI liegen dort
// die heruntergeladenen Artefakte der Build-Jobs (Windows/Linux/macOS).
// Erkannt werden: NSIS-Installer (*-setup.exe), portables Windows-Zip (*-portable.zip), AppImage, .deb, .dmg und das macOS-Update-Archiv (*.app.tar.gz),
// jeweils mit .sig für den Updater.
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const repo = process.env.GITHUB_REPOSITORY || "vibec-studios/vibe-launcher";
const { tag, version } = args;
if (!tag || !version) throw new Error("--tag und --version sind Pflicht");
const out = args.out || "release-files";
const from = args.from || "src-tauri/target";
const required = (args.require || "").split(",").filter(Boolean);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

/** Neueste passende Datei (bei mehreren Builds im Ordner). */
function find(files, test) {
  return files
    .filter((f) => test(path.basename(f)))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

const files = walk(from).filter((f) => f.includes(`${path.sep}bundle${path.sep}`) || !from.includes("target"));
const hasVer = (n) => n.includes(version);

// Plattform -> { quelle, Zielname, Updater-Schlüssel }
const kinds = [
  { os: "windows", test: (n) => n.endsWith("-setup.exe") && hasVer(n), name: `Vibe-Launcher_${version}_x64-setup.exe`, updater: ["windows-x86_64"] },
  { os: "windows", test: (n) => n.endsWith("-portable.zip") && hasVer(n), name: `Vibe-Launcher_${version}_x64-portable.zip`, updater: [], optional: true },
  { os: "linux", test: (n) => n.endsWith(".AppImage") && hasVer(n), name: `Vibe-Launcher_${version}_amd64.AppImage`, updater: ["linux-x86_64"] },
  { os: "linux", test: (n) => n.endsWith(".deb") && hasVer(n), name: `Vibe-Launcher_${version}_amd64.deb`, updater: [] },
  { os: "macos", test: (n) => n.endsWith(".dmg") && hasVer(n), name: `Vibe-Launcher_${version}_universal.dmg`, updater: [] },
  // Das Update-Archiv trägt keine Version im Namen („Vibe Launcher.app.tar.gz“)
  { os: "macos", test: (n) => n.endsWith(".app.tar.gz"), name: `Vibe-Launcher_${version}_universal.app.tar.gz`, updater: ["darwin-x86_64", "darwin-aarch64"] },
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const platforms = {};
const found = new Set();
for (const k of kinds) {
  const src = find(files, k.test);
  if (!src) continue;
  if (!k.optional) found.add(k.os);
  fs.copyFileSync(src, path.join(out, k.name));
  if (!k.updater.length) continue;
  const sig = src + ".sig";
  if (!fs.existsSync(sig)) throw new Error(`Signatur fehlt: ${sig} (TAURI_SIGNING_PRIVATE_KEY gesetzt?)`);
  fs.copyFileSync(sig, path.join(out, k.name + ".sig"));
  for (const key of k.updater) {
    platforms[key] = {
      signature: fs.readFileSync(sig, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${k.name}`,
    };
  }
}

for (const os of required) if (!found.has(os)) throw new Error(`Kein Build für ${os} in ${from} gefunden`);
if (!Object.keys(platforms).length) throw new Error(`Keine Installer für ${version} in ${from} gefunden`);

// Feste Namen für Download-Links (Website/README): …/releases/latest/download/Vibe-Launcher-Setup.exe usw.
if (tag !== "dev") {
  const alias = { [`Vibe-Launcher_${version}_x64-setup.exe`]: "Vibe-Launcher-Setup.exe", [`Vibe-Launcher_${version}_amd64.AppImage`]: "Vibe-Launcher.AppImage", [`Vibe-Launcher_${version}_amd64.deb`]: "Vibe-Launcher.deb", [`Vibe-Launcher_${version}_universal.dmg`]: "Vibe-Launcher.dmg", [`Vibe-Launcher_${version}_x64-portable.zip`]: "Vibe-Launcher-Portable.zip" };
  for (const [src, dst] of Object.entries(alias)) if (fs.existsSync(path.join(out, src))) fs.copyFileSync(path.join(out, src), path.join(out, dst));
}

const latest = { version, notes: args.notes || "", pub_date: new Date().toISOString(), platforms };
fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(latest, null, 2));
console.log(`Plattformen: ${Object.keys(platforms).join(", ")}`);
console.log(`Bereit in ${out}/: ${fs.readdirSync(out).join(", ")}`);
