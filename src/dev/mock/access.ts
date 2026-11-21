import type { AccessInfo, AccessStatus } from "@/features/access/types";

function flag(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

const STATUSES: AccessStatus[] = ["none", "waitlist", "approved", "rejected"];
const initial = flag("vl.mock.access") as AccessStatus | null;
const mode = flag("vl.mock.access.mode") === "open" ? "open" : "waitlist";
const approveAfter = Number(flag("vl.mock.access.approve_after")) || 0;
const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

let info: AccessInfo = {
  status: initial && STATUSES.includes(initial) ? initial : "approved",
  position: null,
  total: null,
  requestedAt: null,
  decidedAt: null,
  reason: null,
  mode,
};
if (info.status === "waitlist") info = { ...info, position: 12, total: 40, requestedAt: day(3) };
if (info.status === "rejected") info = { ...info, requestedAt: day(9), decidedAt: day(2), reason: "Die Beta ist gerade voll. Versuch es in ein paar Wochen noch einmal." };
if (info.status === "approved") info = { ...info, requestedAt: day(30), decidedAt: day(28) };
let waitingSince = info.status === "waitlist" ? Date.now() : 0;

export const accessStatus = () => info.status;

export function approveByInvite(): AccessInfo {
  if (info.status !== "approved") info = { ...info, status: "approved", position: null, total: null, reason: null, decidedAt: new Date().toISOString() };
  return info;
}

export function accessCode() {
  return info.status === "waitlist" ? "ACCESS_PENDING" : info.status === "rejected" ? "ACCESS_REJECTED" : "ACCESS_NONE";
}

function current(): AccessInfo {
  if (info.status === "waitlist" && approveAfter && Date.now() - waitingSince >= approveAfter) {
    info = { ...info, status: "approved", position: null, total: null, decidedAt: new Date().toISOString() };
  }
  return info;
}

export function accessRoute(method: string, rel: string): { status: number; body?: unknown } | null {
  if (rel === "access" && method === "GET") return { status: 200, body: current() };
  if (rel !== "access/request") return null;
  if (method === "POST") {
    if (info.status === "none" || info.status === "rejected") {
      info =
        info.mode === "open"
          ? { ...info, status: "approved", position: null, total: null, reason: null, requestedAt: new Date().toISOString(), decidedAt: new Date().toISOString() }
          : { ...info, status: "waitlist", position: 41, total: 41, reason: null, decidedAt: null, requestedAt: new Date().toISOString() };
      waitingSince = Date.now();
    }
    return { status: 200, body: current() };
  }
  if (method === "DELETE") {
    if (info.status === "waitlist" || info.status === "rejected") info = { ...info, status: "none", position: null, total: null, requestedAt: null, decidedAt: null, reason: null };
    return { status: 200, body: info };
  }
  return null;
}

export function accessExempt(method: string, rel: string) {
  return rel === "meta" || rel.startsWith("auth/") || rel.startsWith("access") || rel.startsWith("feedback") || (method === "DELETE" && rel === "me") || (rel.startsWith("packs") && method === "GET");
}
