import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";

const manifest = process.argv[2] ?? "agent/Cargo.toml";
const meta = JSON.parse(
  execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1", "--manifest-path", manifest], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  }),
);
const pkg = meta.packages.find((p) => p.name === "vibe-agent");
if (!pkg) {
  console.error("::error::Paket vibe-agent nicht im Cargo-Workspace gefunden");
  process.exit(1);
}
const slash = (s) => s.split(path.sep).join("/") || ".";
const base = process.env.GITHUB_WORKSPACE ?? process.cwd();
const out = {
  version: pkg.version,
  root: slash(path.relative(base, meta.workspace_root)),
  "rel-target": slash(path.relative(meta.workspace_root, meta.target_directory)),
  target: slash(meta.target_directory),
};
const lines = Object.entries(out).map(([k, v]) => `${k}=${v}`);
console.log(lines.join("\n"));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
