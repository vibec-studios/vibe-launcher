import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCss, sanitizeStyleAttr } from "./css/sanitize.ts";
import { tokenize } from "./css/tokenize.ts";
import { parseComponents } from "./css/parse.ts";
import { serialize } from "./css/serialize.ts";
import { Report } from "./report.ts";
import { LIMITS } from "./rules.ts";

const GUARD = ":not(#_vt_):where([data-vt-scope],[data-vt-scope] *):not(:where([data-vt-protected],[data-vt-protected] *,[data-vt-lock]))";

function clean(css: string) {
  const r = new Report();
  return { css: sanitizeCss(css, "clean", r), warnings: r.list().map((w) => w.code) };
}

function scoped(css: string) {
  const r = new Report();
  return { css: sanitizeCss(css, "scoped", r), warnings: r.list().map((w) => w.code) };
}

function selectors(css: string): string[] {
  return [...css.matchAll(/(?:^|[{};]\s*\n)([^{};@]+?)\s*\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => !/^(from|to|\d)/.test(s))
    .flatMap((s) => s.split(",\n"));
}

test("tokenizer decodes escapes and keeps url tokens", () => {
  const t = tokenize("u\\72 l(http://x) 'a\\\"b' #id 1e3 10px 50%");
  assert.equal(t[0].t, "url");
  assert.deepEqual(t.filter((x) => x.t === "str").map((x) => (x as { v: string }).v), ['a"b']);
  assert.ok(t.some((x) => x.t === "hash"));
  assert.ok(t.some((x) => x.t === "dim" && x.unit === "px"));
});

test("serializer keeps comment-separated tokens apart", () => {
  assert.equal(serialize(parseComponents("1/**/px")), "1/**/px");
  assert.equal(serialize(parseComponents("a/**/b")), "a/**/b");
  assert.equal(serialize(parseComponents('"x\\"y"')), '"x\\"y"');
});

test("blocks @import, @namespace, @layer, @property, @scope and nested rules", () => {
  const r = clean("@import url(a.css); @namespace svg url(x); @layer base { a { color: red } } @property --x { syntax: '*' } @scope (a) { b { color: red } } .a { .b { color: red } }");
  assert.equal(r.css, "");
  assert.ok(r.warnings.includes("css.at_rule"));
  assert.ok(r.warnings.includes("css.nested"));
});

test("removes external urls, javascript:, expression(), behavior and -moz-binding", () => {
  const r = clean(`.a {
    background: url(https://evil.example/p.png);
    background-image: url("javascript:alert(1)");
    width: expression(alert(1));
    behavior: url(x.htc);
    -moz-binding: url(x.xml#a);
    cursor: url(//evil/c.cur), auto;
    background: image-set("https://evil/a.png" 1x);
    content: attr(title);
    mask: url(/local.svg);
    color: red;
  }`);
  assert.match(r.css, /color: red/);
  assert.doesNotMatch(r.css, /evil|javascript|expression|behavior|binding|image-set|attr\(|local\.svg/);
  for (const w of ["css.url", "css.value", "css.property"] as const) assert.ok(r.warnings.includes(w), w);
});

test("escaped url and comment tricks do not get through", () => {
  const r = clean(".a { background: u\\72 l(https://evil/x); b: \\75 rl(https://evil/y); c: url/**/(https://evil/z) }");
  assert.doesNotMatch(r.css, /evil/);
});

test("allows small embedded images and woff2 fonts in @font-face only", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const r = clean(`@font-face { font-family: Orbitron; src: url(data:font/woff2;base64,d09GMgAB) format("woff2"), local(Arial); }
    .a { background: url(${png}) }
    .b { background: url(data:font/woff2;base64,AAAA) }
    @font-face { font-family: Bad; src: url(https://fonts.example/x.woff2) }`);
  assert.match(r.css, /@font-face \{\n {2}font-family: "Orbitron";\n {2}src: url\("data:font\/woff2;base64,d09GMgAB"\) format\("woff2"\);/);
  assert.match(r.css, /iVBORw0KGgo/);
  assert.doesNotMatch(r.css, /local\(|fonts\.example|\.b \{/);
});

test("enforces font and image budgets", () => {
  const big = "A".repeat(Math.ceil((LIMITS.fontBytes + 10) * (4 / 3)));
  const r = clean(`@font-face { font-family: Big; src: url(data:font/woff2;base64,${big}) }`);
  assert.equal(r.css, "");
  assert.ok(r.warnings.includes("font.too_big"));
  const img = "A".repeat(Math.ceil((LIMITS.imageBytes + 10) * (4 / 3)));
  const r2 = clean(`.a { background: url(data:image/png;base64,${img}) }`);
  assert.ok(r2.warnings.includes("image.too_big"));
  assert.equal(r2.css, "");
});

test("drops position fixed, clamps z-index and blocks pointer-events and app-region", () => {
  const r = clean(".a { position: fixed; z-index: 99999; pointer-events: auto; -webkit-app-region: drag; position: absolute }");
  assert.match(r.css, /z-index: 10;/);
  assert.match(r.css, /position: absolute;/);
  assert.doesNotMatch(r.css, /fixed|pointer-events|app-region/);
  assert.match(clean(".a { z-index: -500 }").css, /z-index: -10;/);
  assert.equal(clean(".a { z-index: calc(1000) }").css, "");
});

test("every scoped selector carries the theme scope guard", () => {
  const r = scoped(`[data-part=button], .x > .y + .z ~ span, a:hover::before, :is(.a, .b) .c, svg circle:nth-child(2n+1) { color: red }
    @media (min-width: 900px) { [data-slot="home-hero"] .ring { color: blue } }`);
  const sels = selectors(r.css);
  assert.ok(sels.length >= 6);
  for (const s of sels) assert.ok(s.includes(GUARD), s);
  assert.match(r.css, /\[data-part~="button"\]/);
  assert.match(r.css, /\.vt-x > \.vt-y \+ \.vt-z ~ span/);
  assert.match(r.css, /::before \{\n {2}pointer-events: none !important;/);
});

test("selectors cannot target or reference protected areas or theme internals", () => {
  const r = clean("[data-vt-protected] button { color: red } html:has([data-vt-scope]) a { color: red } svg|a { color: red } & a { color: red } a::part(x) { color: red } :host { color: red }");
  assert.equal(r.css, "");
  assert.ok(r.warnings.includes("css.selector"));
});

test(":root rules land on the scope roots, keyframes and fonts are prefixed", () => {
  const r = scoped(':root { --hud: #f00 } .r { animation: spin 2s linear infinite; font-family: "Iron Font", sans-serif } @keyframes spin { to { transform: rotate(1turn) } } @font-face { font-family: "Iron Font"; src: url(data:font/woff2;base64,AAAA) }');
  assert.match(r.css, /:root :where\(\[data-vt-scope\] > \*\):not\(#_vt_\)/);
  assert.match(r.css, /animation: vt-spin 2s linear infinite/);
  assert.match(r.css, /@keyframes vt-spin/);
  assert.match(r.css, /font-family: "vt-Iron Font", sans-serif/);
  assert.match(r.css, /@font-face \{\n {2}font-family: "vt-Iron Font"/);
});

test("app font names in @font-face are prefixed so they cannot replace app fonts", () => {
  const r = scoped('@font-face { font-family: Inter; src: url(data:font/woff2;base64,AAAA) }');
  assert.match(r.css, /font-family: "vt-Inter"/);
  assert.doesNotMatch(r.css, /font-family: "Inter"/);
});

test("huge and hostile inputs stay bounded", () => {
  const many = Array.from({ length: LIMITS.cssRules + 50 }, (_, i) => `.r${i} { color: red }`).join("\n");
  const r = clean(many);
  assert.ok(r.warnings.includes("css.limit"));
  assert.equal(r.css.match(/\{/g)?.length, LIMITS.cssRules);
  const deep = `${"@media all {".repeat(50)} a { color: red } ${"}".repeat(50)}`;
  assert.doesNotMatch(clean(deep).css, /color/);
  const t0 = Date.now();
  clean(`a{b:${"(".repeat(20000)}`);
  clean(`/*${"x".repeat(200000)}`);
  clean(`"${"\\".repeat(100000)}`);
  assert.ok(Date.now() - t0 < 3000);
});

test("animations cannot override reduced motion with !important", () => {
  const r = clean(".a { animation: spin 2s infinite !important; animation-duration: 5s !important; color: red !important }");
  assert.match(r.css, /animation: spin 2s infinite;/);
  assert.match(r.css, /animation-duration: 5s;/);
  assert.match(r.css, /color: red !important;/);
});

test("style attributes use the same declaration rules", () => {
  const r = new Report();
  assert.equal(sanitizeStyleAttr("color: red; background: url(https://evil); position: fixed; width: 10px", "clean", r), "color: red; width: 10px");
});

test("clean output is stable when sanitized again", () => {
  const src = `[data-part="card"] { border-radius: 0; box-shadow: inset 0 0 0 1px rgb(255 110 60 / .22) }
    @keyframes k { 0%, 50% { opacity: .5 } to { opacity: 1 } }
    @media (prefers-reduced-motion: no-preference) { .a::after { content: "\\201C"; animation: k 1s } }`;
  const once = clean(src).css;
  assert.equal(clean(once).css, once);
});
