import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMarkup, serializeMarkup, type MNode } from "./markup/sanitize.ts";
import { compileMarkup, fillText } from "./markup/compile.ts";
import { Report } from "./report.ts";
import { LIMITS } from "./rules.ts";

function run(src: string) {
  const report = new Report();
  const nodes = sanitizeMarkup(src, report, { total: 0 });
  return { nodes, html: serializeMarkup(nodes), warnings: report.list().map((w) => `${w.code}:${w.detail ?? ""}`) };
}

test("removes scripts, event handlers, links, forms, iframes and foreignObject", () => {
  const r = run(`<div onclick="x()" class="a">ok<script>alert(1)</script><SCRIPT src=//evil></SCRIPT>
    <img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a><form action=//evil><input name=p><button>go</button></form>
    <iframe src=//evil></iframe><svg><foreignObject><div onload=x>hi</div></foreignObject><script>1</script><a href="//evil"><circle r="1"/></a></svg>
    <object data=x></object><embed src=x><style>body{}</style><template><b>x</b></template><video src=x></video></div>`);
  assert.doesNotMatch(r.html, /script|onclick|onerror|onload|javascript|iframe|form|input|button|foreignObject|object|embed|style>|template|video|href|evil|<a/i);
  assert.match(r.html, /^<div class="a">ok/);
  assert.match(r.html, /\slink\s/);
  assert.ok(r.warnings.some((w) => w.startsWith("markup.attribute:onclick")));
  assert.ok(r.warnings.some((w) => w.startsWith("markup.element:script")));
});

test("only embedded images and local references are kept", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const r = run(`<img src="${png}"><img src="https://evil/x.png"><img src="data:text/html,<script>"><svg>
    <use href="#a"/><use href="https://evil/s.svg#a"/><use xlink:href="data:image/svg+xml,x#a"/>
    <circle fill="url(#g)" stroke="url(https://evil)" filter="url( 'javascript:x' )" style="fill: url(https://evil)"/>
    <rect style="fill: red; position: fixed"/></svg>`);
  assert.equal(r.html.match(/<img/g)?.length, 1);
  assert.match(r.html, /<use href="#a"\/>/);
  assert.equal(r.html.match(/<use/g)?.length, 1);
  assert.match(r.html, /<circle fill="url\(#g\)"\/>/);
  assert.match(r.html, /<rect style="fill: red"\/>/);
  assert.doesNotMatch(r.html, /evil|javascript|data:text/);
});

test("svg animation elements, unknown svg nodes and namespaced tags are dropped", () => {
  const r = run(`<svg><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="onclick"/><title>t</title><svg:script>x</svg:script><g><path d="M0 0"/></g></svg>`);
  assert.equal(r.html, '<svg><g><path d="M0 0"/></g></svg>');
});

test("unknown harmless html is unwrapped, entities are decoded and re-escaped", () => {
  const r = run("<section><h2>Hi &amp; &lt;b&gt; &#x3C;script&#x3E;</h2><center>c</center></section>");
  assert.equal(r.html, "<h2>Hi &amp; &lt;b&gt; &lt;script&gt;</h2>c");
});

test("placeholders become text nodes and are filled as text", () => {
  const r = run("<p>{{greeting}}, {{ player }}! {{unknown}} {{time}}</p>");
  const p = r.nodes[0] as MNode & { t: "el" };
  assert.deepEqual(p.kids.filter((k) => k.t === "ph").map((k) => (k as { k: string }).k), ["greeting", "player", "time"]);
  assert.ok(r.warnings.includes("markup.placeholder:unknown"));
  const text = fillText(r.nodes, { greeting: "Hallo", player: '<img src=x onerror="alert(1)">', time: "10:00" });
  assert.equal(text, 'Hallo, <img src=x onerror="alert(1)">! {{unknown}} 10:00');
  const filled: MNode[] = [{ t: "tx", v: text }];
  assert.equal(serializeMarkup(filled), 'Hallo, &lt;img src=x onerror="alert(1)"&gt;! {{unknown}} 10:00');
});

test("node, depth and size limits", () => {
  const deep = run(`${"<div>".repeat(LIMITS.depth + 10)}x${"</div>".repeat(LIMITS.depth + 10)}`);
  assert.ok(deep.warnings.some((w) => w.startsWith("markup.limit")));
  const wide = run("<i>a</i>".repeat(LIMITS.slotNodes + 50));
  assert.ok((wide.html.match(/<i>/g)?.length ?? 0) <= LIMITS.slotNodes);
  const budget = { total: LIMITS.totalNodes - 1 };
  const r = new Report();
  assert.equal(sanitizeMarkup("<b>1</b><b>2</b>", r, budget).length, 1);
  const t0 = Date.now();
  run("<".repeat(100_000));
  run(`<div a="${"x".repeat(200_000)}`);
  run(`<div ${"a=b ".repeat(50_000)}>`);
  assert.ok(Date.now() - t0 < 3000);
});

test("sanitizing clean markup again changes nothing", () => {
  const src = '<div class="j"><svg viewBox="0 0 10 10"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/></radialGradient></defs><circle r="4" fill="url(#g)"/></svg><p>{{greeting}}, {{player}}.</p><br><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>';
  const once = run(src).html;
  assert.equal(run(once).html, once);
});

test("compiling prefixes classes, ids and local references", () => {
  const r = run('<div class="ring big" id="x"><svg><use href="#x"/><circle fill="url(#g)" style="animation: spin 2s"/></svg></div>');
  const out = serializeMarkup(compileMarkup(r.nodes, "scoped", { keyframes: new Map([["spin", "vt-spin"]]), fonts: new Map() }, new Report()));
  assert.match(out, /class="vt-ring vt-big" id="vt-x"/);
  assert.match(out, /href="#vt-x"/);
  assert.match(out, /fill="url\(#vt-g\)"/);
  assert.match(out, /animation: vt-spin 2s/);
});
