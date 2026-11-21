import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rmrf } from "./fsutil.mjs";

const run = promisify(execFile);
const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

export async function readIndex(file, scratch) {
  await rmrf(scratch);
  await fsp.mkdir(scratch, { recursive: true });
  await run(tar, ["-xf", file, "-C", scratch, "modrinth.index.json"], { windowsHide: true });
  const index = JSON.parse(await fsp.readFile(path.join(scratch, "modrinth.index.json"), "utf8"));
  await rmrf(scratch);
  const client = index.files.filter((f) => f.env?.client !== "unsupported");
  return {
    name: index.name,
    versionId: index.versionId,
    dependencies: index.dependencies,
    files: client.length,
    mods: client.filter((f) => f.path.startsWith("mods/")).length,
    downloadBytes: client.reduce((s, f) => s + (f.fileSize ?? 0), 0),
  };
}

export async function makeVanillaPack(out, mcVersion, scratch) {
  await rmrf(scratch);
  await fsp.mkdir(scratch, { recursive: true });
  const index = { formatVersion: 1, game: "minecraft", versionId: "bench-vanilla", name: "Bench Vanilla", files: [], dependencies: { minecraft: mcVersion } };
  await fsp.writeFile(path.join(scratch, "modrinth.index.json"), JSON.stringify(index, null, 2));
  const zip = out.replace(/\.mrpack$/, ".zip");
  await fsp.rm(zip, { force: true });
  await run(tar, ["-a", "-c", "-f", zip, "-C", scratch, "modrinth.index.json"], { windowsHide: true });
  await fsp.rename(zip, out);
  await rmrf(scratch);
  return out;
}
