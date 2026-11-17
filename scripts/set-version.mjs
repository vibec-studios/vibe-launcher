// Setzt die Version in package.json und src-tauri/Cargo.toml.
//   node scripts/set-version.mjs dev <build-nr>   -> <major>.<minor>.<patch+1>-dev.<build-nr>
//   node scripts/set-version.mjs 1.2.3            -> 1.2.3
// Gibt die Version aus und schreibt sie (in GitHub Actions) nach $GITHUB_OUTPUT als `version`.
import fs from "node:fs";

const [, , arg, build] = process.argv;
const pkgPath = "package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const base = pkg.version.replace(/-.*$/, "");

let version;
if (arg === "dev") {
  if (!/^\d+$/.test(build ?? "")) throw new Error("Build-Nummer fehlt");
  const [ma, mi, pa] = base.split(".").map(Number);
  version = `${ma}.${mi}.${pa + 1}-dev.${build}`;
} else if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(arg ?? "")) {
  version = arg;
} else {
  throw new Error(`Ungültige Version: ${arg}`);
}

pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const cargoPath = "src-tauri/Cargo.toml";
const cargo = fs.readFileSync(cargoPath, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`);
fs.writeFileSync(cargoPath, cargo);

console.log(version);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
