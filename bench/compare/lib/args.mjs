export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split("=", 2);
    if (inline !== undefined) out[k] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

export const list = (v, all) => (!v || v === true || v === "all" ? all : String(v).split(",").map((s) => s.trim()).filter(Boolean));
export const num = (v, d) => (v === undefined || v === true ? d : Number(v));
