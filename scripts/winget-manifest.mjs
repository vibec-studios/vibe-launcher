// Erzeugt die winget-Manifeste (docs/WINGET.md) für eine veröffentlichte Version. Reicht nichts ein.
//   node scripts/winget-manifest.mjs --version 1.0.0-beta.5 [--sha256 <hex> | --installer <pfad-zur-setup.exe>]
// Ohne --sha256/--installer wird die Prüfsumme aus der öffentlichen GitHub-API gelesen (Feld `digest` des Assets).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const repo = process.env.GITHUB_REPOSITORY || "vibec-studios/vibe-launcher";
const version = args.version || JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const id = "VibeCraftStudios.VibeLauncher";
const asset = `Vibe-Launcher_${version}_x64-setup.exe`;
const url = `https://github.com/${repo}/releases/download/v${version}/${asset}`;
const schema = "1.9.0";

async function sha256() {
  if (args.sha256) return args.sha256;
  if (args.installer) return crypto.createHash("sha256").update(fs.readFileSync(args.installer)).digest("hex");
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${version}`, { headers: { accept: "application/vnd.github+json", "user-agent": "vibe-winget-manifest" } });
  if (!res.ok) throw new Error(`Release v${version} nicht gefunden (${res.status})`);
  const rel = await res.json();
  const a = rel.assets.find((x) => x.name === asset);
  if (!a?.digest?.startsWith("sha256:")) throw new Error(`Keine SHA-256 für ${asset} – mit --installer oder --sha256 angeben`);
  return a.digest.slice("sha256:".length);
}

const header = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${schema}.schema.json\n`;

const files = (hash) => ({
  [`${id}.yaml`]: `${header("version")}
PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${schema}
`,
  [`${id}.installer.yaml`]: `${header("installer")}
PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerType: nullsoft
Scope: user
InstallModes:
  - interactive
  - silent
  - silentWithProgress
UpgradeBehavior: install
Protocols:
  - vibelauncher
Installers:
  - Architecture: x64
    InstallerUrl: ${url}
    InstallerSha256: ${hash.toUpperCase()}
ManifestType: installer
ManifestVersion: ${schema}
`,
  [`${id}.locale.en-US.yaml`]: `${header("defaultLocale")}
PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Vibe Craft Studios
PublisherUrl: https://github.com/vibec-studios
PublisherSupportUrl: https://github.com/${repo}/issues
PackageName: Vibe Launcher
PackageUrl: https://vibe.axolite.app/launcher
License: Apache-2.0
LicenseUrl: https://github.com/${repo}/blob/main/LICENSE
Copyright: © Vibe Craft Studios
ShortDescription: Minecraft launcher with instances, Modrinth and CurseForge, modpacks and skins.
Description: Free Minecraft launcher without ads or telemetry. Instances, Modrinth and CurseForge, modpacks, skins, local servers and optional online features (Vibe).
Moniker: vibe-launcher
Tags:
  - minecraft
  - launcher
  - modrinth
  - curseforge
  - modpacks
ReleaseNotesUrl: https://github.com/${repo}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: ${schema}
`,
  [`${id}.locale.de-DE.yaml`]: `${header("locale")}
PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: de-DE
Publisher: Vibe Craft Studios
PackageName: Vibe Launcher
License: Apache-2.0
ShortDescription: Minecraft-Launcher mit Instanzen, Modrinth und CurseForge, Modpacks und Skins.
Description: Kostenloser Minecraft-Launcher ohne Werbung und ohne Telemetrie. Instanzen, Modrinth und CurseForge, Modpacks, Skins, lokale Server und optionale Online-Funktionen (Vibe).
ManifestType: locale
ManifestVersion: ${schema}
`,
});

const hash = await sha256();
if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error(`Ungültige SHA-256: ${hash}`);
const dir = path.join("packaging", "winget", "manifests", "v", "VibeCraftStudios", "VibeLauncher", version);
fs.mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(files(hash))) fs.writeFileSync(path.join(dir, name), text);
console.log(`winget-Manifeste in ${dir} (nicht eingereicht)`);
