import type { CustomLoaderPack, CustomLoaderPreview, Instance } from "@/lib/types";
import { instances } from "./core";
import type { Handlers } from "./util";

export const priority = 4;

const flag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

const mode = flag("vl.mock.customloaders");
const now = Date.now();

const sample = (version: string, mc: string[], instancesUsing: number): CustomLoaderPack => ({
  id: "example",
  name: "Example Loader",
  loader_version: version,
  description: "Ein erfundener Loader für visuelle Tests.",
  author: "Example Studio",
  homepage: "https://example.com/loader",
  minecraft: mc,
  mods: "fabric",
  main_class: "com.example.loader.Main",
  icon_path: null,
  library_count: 4,
  size_bytes: 1_843_200,
  instances: instancesUsing,
});

let packs: CustomLoaderPack[] =
  mode === "empty" ? [] : [sample("0.1.0", ["1.21.4", "1.21.1"], 1), sample("0.2.0", ["1.21.4"], 0), { ...sample("1.0.0", ["1.20.1"], 0), id: "tiny-loader", name: "Tiny Loader", mods: "forge", author: null }];

if (mode !== null && mode !== "empty") {
  const base = [...instances.values()][0];
  if (base) {
    const i: Instance = {
      ...base,
      id: "example-loader-test",
      name: "Example Loader Test",
      mc_version: "1.21.4",
      loader: { kind: "fabric", version: "0.1.0" },
      custom_loader: { id: "example", version: "0.1.0" },
      source: null,
      last_played: now - 3_600_000,
    };
    instances.set(i.id, i);
  }
}

const preview = (): CustomLoaderPreview => ({
  id: "example",
  name: "Example Loader",
  loader_version: mode === "replace" ? "0.1.0" : "0.3.0",
  description: "Ein erfundener Loader für visuelle Tests.",
  author: "Example Studio",
  homepage: "https://example.com/loader",
  icon: null,
  minecraft: ["1.21.4", "1.21.1"],
  mods: "fabric",
  main_class: "com.example.loader.Main",
  jvm_args: ["-Dexample.flag=true"],
  game_args: [],
  library_count: 4,
  local_count: 3,
  library_bytes: 1_843_200,
  remote: [{ name: "org.ow2.asm:asm:9.7", url: "https://repo1.maven.org/maven2/org/ow2/asm/asm/9.7/asm-9.7.jar", size: 125_428 }],
  exists: mode === "replace",
  installed_versions: packs.filter((p) => p.id === "example").map((p) => p.loader_version),
});

const handlers: Handlers = {
  custom_loaders_list: () => packs,
  custom_loader_inspect: () =>
    mode === "invalid"
      ? { status: "error", issue: { code: "unsafe_path", message: "Das Pack enthält einen unzulässigen Pfad: „../evil.jar“.", params: { path: "../evil.jar" } } }
      : { status: "ok", preview: preview() },
  custom_loader_import: () => {
    const p = preview();
    const pack = { ...sample(p.loader_version, p.minecraft, 0) };
    packs = [...packs.filter((x) => !(x.id === pack.id && x.loader_version === pack.loader_version)), pack];
    return pack;
  },
  custom_loader_delete: ({ id, version }) => {
    const p = packs.find((x) => x.id === id && x.loader_version === version);
    if (p && p.instances > 0) throw { kind: "invalid", message: `Das Loader-Pack wird noch von ${p.instances} Instanz benutzt.` };
    packs = packs.filter((x) => x !== p);
  },
};

export default handlers;
