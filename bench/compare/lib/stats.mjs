export function summarize(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { n: v.length, median: q(0.5), p25: q(0.25), p75: q(0.75), min: v[0], max: v[v.length - 1], mean, sd, cv: mean ? sd / mean : 0 };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 60000, interval = 100, label = "Bedingung" } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const r = await fn();
    if (r) return r;
    if (Date.now() > end) throw new Error(`Zeitüberschreitung: ${label}`);
    await sleep(interval);
  }
}
