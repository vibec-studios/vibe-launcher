import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseThemeInput } from "./document.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKILL = new URL("../../../skills/vibe-launcher-theme/", import.meta.url);
const node = (args: string[]) => execFileSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });

test("skill core is generated from the launcher sources", () => {
  assert.match(node(["scripts/theme-skill-sync.mjs", "--check"]), /aktuell/);
});

test("examples: validate.mjs code imports to the same theme in the launcher", () => {
  const dir = new URL("examples/", SKILL);
  for (const name of fs.readdirSync(dir)) {
    const file = fileURLToPath(new URL(name, dir));
    const out = node([fileURLToPath(new URL("validate.mjs", SKILL)), file, "--code-only"]).trim();
    assert.match(out, /^VIBE-THEME-[12]:[A-Za-z0-9_-]+$/, name);
    const viaCode = parseThemeInput(out, "x");
    const direct = parseThemeInput(fs.readFileSync(file, "utf8"), "x");
    assert.deepEqual(viaCode.doc, direct.doc, name);
    assert.equal(out.startsWith("VIBE-THEME-2:"), direct.version === 2, name);
  }
});

test("validate.mjs rejects broken themes", () => {
  const bad = fileURLToPath(new URL("../../../node_modules/.vt-bad.vibetheme", import.meta.url));
  fs.writeFileSync(bad, '{"format":"vibe-launcher-theme","version":2,"values":{"tone":"neon"}}');
  try {
    assert.throws(() => node([fileURLToPath(new URL("validate.mjs", SKILL)), bad]), /values/);
  } finally {
    fs.rmSync(bad, { force: true });
  }
});
