import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const benchDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const resultsDir = path.join(benchDir, "results");

export const pins = {
  mcVersion: "1.21.11",
  memory: { minMb: 1024, maxMb: 4096 },
  java: {
    name: "Eclipse Temurin JRE 21.0.13.1+2",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13.1%2B2/OpenJDK21U-jre_x64_windows_hotspot_21.0.13.1_2.zip",
    sha256: "e15ee1e54a5a3b38027a09cedfa87bc3348d7dd3ce50866dd3d9671d7fffc6c1",
  },
  modpack: {
    name: "Fabulously Optimized 12.3.0 for 1.21.11",
    project: "1KVo5zza",
    version: "K0lc692U",
    url: "https://cdn.modrinth.com/data/1KVo5zza/versions/K0lc692U/Fabulously.Optimized-v13.3.0-mr.1.mrpack",
    sha512: "13a3a2a1e9795056ef2ef343baf3c75eff8af7dd2b300e716a382707622943c1201968bf2748e19d7ff64efbe55b6e73c9567d0b555f4bd34b5725d532b08546",
  },
  logMarker: "Sound engine started",
};

export function workDir(args) {
  return path.resolve(args.work && args.work !== true ? String(args.work) : path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "vibe-launcher-bench"));
}

export function layout(work) {
  return {
    work,
    downloads: path.join(work, "downloads"),
    apps: path.join(work, "apps"),
    data: path.join(work, "data"),
    shared: path.join(work, "shared"),
    state: path.join(work, "state.json"),
  };
}
