export type AccessStatus = "none" | "waitlist" | "approved" | "rejected";

export type AccessMode = "waitlist" | "open";

export interface AccessInfo {
  status: AccessStatus;
  position: number | null;
  total: number | null;
  requestedAt: string | null;
  decidedAt: string | null;
  reason: string | null;
  mode: AccessMode;
}

export type AccessCode = "ACCESS_PENDING" | "ACCESS_REJECTED" | "ACCESS_NONE";

const CODES: Record<AccessCode, AccessStatus> = {
  ACCESS_PENDING: "waitlist",
  ACCESS_REJECTED: "rejected",
  ACCESS_NONE: "none",
};

export function isAccessCode(code: unknown): code is AccessCode {
  return typeof code === "string" && code in CODES;
}

export function statusFromCode(code: string): AccessStatus {
  return isAccessCode(code) ? CODES[code] : "none";
}

export function emptyInfo(status: AccessStatus): AccessInfo {
  return { status, position: null, total: null, requestedAt: null, decidedAt: null, reason: null, mode: "waitlist" };
}

const STATUSES: AccessStatus[] = ["none", "waitlist", "approved", "rejected"];

export function parseInfo(raw: unknown): AccessInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!STATUSES.includes(r.status as AccessStatus)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    status: r.status as AccessStatus,
    position: num(r.position),
    total: num(r.total),
    requestedAt: str(r.requestedAt),
    decidedAt: str(r.decidedAt),
    reason: str(r.reason),
    mode: r.mode === "open" ? "open" : "waitlist",
  };
}
