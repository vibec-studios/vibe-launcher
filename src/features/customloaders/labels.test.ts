import { test } from "node:test";
import assert from "node:assert/strict";
import { customLoaderName, findPack, issueText, packsById } from "./labels.ts";
import type { CustomLoaderPack } from "@/lib/types";

const pack = (version: string, name = "Example Loader"): CustomLoaderPack => ({
  id: "example",
  name,
  loader_version: version,
  description: null,
  author: null,
  homepage: null,
  minecraft: ["26.3"],
  mods: "fabric",
  main_class: "com.example.loader.Main",
  icon_path: null,
  library_count: 1,
  size_bytes: 10,
  instances: 0,
});

test("Pack-Name und Version statt Fabric", () => {
  const packs = [pack("0.1.0"), pack("0.2.0", "Example Loader Neu")];
  assert.equal(customLoaderName({ custom_loader: { id: "example", version: "0.2.0" } }, packs), "Example Loader Neu 0.2.0");
  assert.equal(customLoaderName({ custom_loader: { id: "example", version: "0.9.0" } }, packs), "example 0.9.0");
  assert.equal(customLoaderName({ custom_loader: null }, packs), null);
  assert.equal(findPack(packs, { id: "example", version: "0.1.0" })?.name, "Example Loader");
});

test("Versionen eines Packs sind gruppiert, neueste zuerst", () => {
  const groups = packsById([pack("0.9.0"), pack("0.10.0"), { ...pack("1.0.0"), id: "other" }]);
  assert.deepEqual(groups.map((g) => [g.id, g.versions.map((v) => v.loader_version)]), [["example", ["0.10.0", "0.9.0"]], ["other", ["1.0.0"]]]);
});

test("Fehlercodes werden übersetzt, sonst die Meldung des Backends", () => {
  const t = (k: string, p?: Record<string, string | number>) => (k === "cl.err.unsafe_path" ? `bad ${p?.path}` : k);
  assert.equal(issueText(t, { code: "unsafe_path", message: "x", params: { path: "../a.jar" } }), "bad ../a.jar");
  assert.equal(issueText(t, { code: "neu", message: "Deutsche Meldung", params: {} }), "Deutsche Meldung");
});
