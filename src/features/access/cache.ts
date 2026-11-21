const OK_KEY = "vibe.access.ok";
const SEEN_KEY = "vibe.access.seen";
const JOIN_KEY = "vibe.access.join";

function read(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function write(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    return;
  }
}

function list(k: string): string[] {
  try {
    const v = JSON.parse(read(k) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toggle(k: string, scope: string, on: boolean) {
  const cur = list(k);
  if (cur.includes(scope) === on) return;
  const next = cur.filter((x) => x !== scope);
  if (on) next.push(scope);
  write(k, JSON.stringify(next.slice(-50)));
}

export const accessCache = {
  approved: (scope: string) => list(OK_KEY).includes(scope),
  setApproved: (scope: string, on: boolean) => toggle(OK_KEY, scope, on),
  waited: (scope: string) => list(SEEN_KEY).includes(scope),
  setWaited: (scope: string, on: boolean) => toggle(SEEN_KEY, scope, on),
  pendingJoin(): { note: string } | null {
    try {
      const v = JSON.parse(read(JOIN_KEY) ?? "null");
      return v && typeof v === "object" ? { note: typeof v.note === "string" ? v.note : "" } : null;
    } catch {
      return null;
    }
  },
  setPendingJoin: (note: string | null) => write(JOIN_KEY, note === null ? null : JSON.stringify({ note })),
};
