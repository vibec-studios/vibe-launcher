export type RawNode = { t: "el"; tag: string; attrs: [string, string][]; kids: RawNode[] } | { t: "tx"; v: string };

const VOID = new Set(["br", "img", "hr", "wbr", "input", "meta", "link", "source", "area", "base", "col", "embed", "param", "track"]);
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  times: "×",
  deg: "°",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  euro: "€",
  hearts: "♥",
  star: "☆",
};
const MAX_RAW_NODES = 20_000;
const UNQUOTED = /[^\s>]*/y;

export function decodeEntities(v: string): string {
  return v.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (m, e: string) => {
    if (e[0] !== "#") return NAMED[e] ?? m;
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "�";
  });
}

export function parseMarkup(src: string): RawNode[] {
  const root: { kids: RawNode[] } = { kids: [] };
  const stack: { tag: string; kids: RawNode[] }[] = [{ tag: "", kids: root.kids }];
  const n = src.length;
  let i = 0;
  let count = 0;
  const top = () => stack[stack.length - 1];
  const text = (raw: string) => {
    if (!raw) return;
    const v = decodeEntities(raw);
    const kids = top().kids;
    const last = kids[kids.length - 1];
    if (last?.t === "tx") last.v += v;
    else {
      kids.push({ t: "tx", v });
      count++;
    }
  };
  const close = (tag: string) => {
    for (let k = stack.length - 1; k > 0; k--) {
      if (stack[k].tag === tag) {
        stack.length = k;
        return;
      }
    }
  };
  while (i < n && count < MAX_RAW_NODES) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      text(src.slice(i));
      break;
    }
    text(src.slice(i, lt));
    i = lt;
    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i + 4);
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (src.startsWith("<!", i) || src.startsWith("<?", i)) {
      const e = src.indexOf(">", i);
      i = e === -1 ? n : e + 1;
      continue;
    }
    if (src.startsWith("</", i)) {
      const m = /^<\/([A-Za-z][A-Za-z0-9:-]*)\s*>/.exec(src.slice(i, i + 80));
      if (m) {
        close(m[1].toLowerCase());
        i += m[0].length;
      } else {
        text("<");
        i++;
      }
      continue;
    }
    const m = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(src.slice(i, i + 80));
    if (!m) {
      text("<");
      i++;
      continue;
    }
    const tag = m[1];
    let j = i + m[0].length;
    const attrs: [string, string][] = [];
    let selfClose = false;
    for (;;) {
      while (j < n && /\s/.test(src[j])) j++;
      if (j >= n) break;
      if (src[j] === ">") {
        j++;
        break;
      }
      if (src.startsWith("/>", j)) {
        selfClose = true;
        j += 2;
        break;
      }
      if (src[j] === "/") {
        j++;
        continue;
      }
      const an = /^[^\s"'>/=]+/.exec(src.slice(j, j + 200));
      if (!an) {
        j++;
        continue;
      }
      j += an[0].length;
      while (j < n && /\s/.test(src[j])) j++;
      let value = "";
      if (src[j] === "=") {
        j++;
        while (j < n && /\s/.test(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, j + 1);
          value = src.slice(j + 1, e === -1 ? n : e);
          j = e === -1 ? n : e + 1;
        } else {
          UNQUOTED.lastIndex = j;
          value = (UNQUOTED.exec(src) as RegExpExecArray)[0];
          j += value.length;
        }
      }
      if (attrs.length < 64) attrs.push([an[0], decodeEntities(value)]);
    }
    i = j;
    const el: RawNode = { t: "el", tag, attrs, kids: [] };
    top().kids.push(el);
    count++;
    const lower = tag.toLowerCase();
    if (!selfClose && !VOID.has(lower)) stack.push({ tag: lower, kids: el.kids });
  }
  return root.kids;
}
