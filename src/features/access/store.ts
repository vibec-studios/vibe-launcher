import { create } from "zustand";
import { VibeError, type VibeClient } from "@/lib/vibe-sdk";
import { accessCache } from "./cache";
import { emptyInfo, isAccessCode, parseInfo, statusFromCode, type AccessInfo, type AccessStatus } from "./types";

export type AccessView = AccessStatus | "unknown";

interface AccessState {
  scope: string | null;
  status: AccessView;
  info: AccessInfo | null;
  checkedAt: number;
  busy: boolean;
}

export const useVibeAccess = create<AccessState>(() => ({ scope: null, status: "unknown", info: null, checkedAt: 0, busy: false }));

const set = useVibeAccess.setState;
const get = useVibeAccess.getState;

export const isBlocked = (s: AccessView) => s === "none" || s === "waitlist" || s === "rejected";

type Listener = (allowed: boolean) => void;
const listeners = new Set<Listener>();
let welcome: () => void = () => {};
let bound: VibeClient | null = null;

export function onAccessChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setWelcomeHook(fn: () => void) {
  welcome = fn;
}

export function bindAccess(client: VibeClient | null, scope: string | null) {
  bound = client;
  set({ scope, status: scope && accessCache.approved(scope) ? "approved" : "unknown", info: null, checkedAt: 0, busy: false });
}

export function clearAccess() {
  set({ status: "unknown", info: null, checkedAt: 0, busy: false });
}

export function forgetAccess() {
  const scope = get().scope;
  if (scope) {
    accessCache.setApproved(scope, false);
    accessCache.setWaited(scope, false);
  }
  clearAccess();
}

function apply(info: AccessInfo) {
  const prev = get().status;
  const scope = get().scope;
  set({ status: info.status, info, checkedAt: Date.now() });
  if (scope) {
    accessCache.setApproved(scope, info.status === "approved");
    if (info.status !== "approved") accessCache.setWaited(scope, true);
    else if (accessCache.waited(scope)) {
      accessCache.setWaited(scope, false);
      welcome();
    }
  }
  if (isBlocked(prev) !== isBlocked(info.status)) for (const l of listeners) l(!isBlocked(info.status));
}

const isLegacy = (e: unknown) => e instanceof VibeError && e.status === 404;

async function fetchInfo(c: VibeClient): Promise<AccessInfo> {
  const info = parseInfo(await c.request<unknown>("GET", "/api/v1/access"));
  if (!info) throw new VibeError(0, "bad_response", "Ungültige Antwort");
  return info;
}

async function postRequest(c: VibeClient, note: string): Promise<AccessInfo> {
  const body = { source: "launcher", ...(note.trim() ? { note: note.trim().slice(0, 500) } : {}) };
  const info = parseInfo(await c.request<unknown>("POST", "/api/v1/access/request", { body }));
  if (!info) throw new VibeError(0, "bad_response", "Ungültige Antwort");
  return info;
}

export async function ensureAccess(c: VibeClient): Promise<boolean> {
  bound = c;
  const scope = get().scope;
  const pending = accessCache.pendingJoin();
  if (scope && !pending && accessCache.approved(scope)) {
    set({ status: "approved" });
    return true;
  }
  try {
    let info = await fetchInfo(c);
    if (pending && (info.status === "none" || info.status === "rejected")) info = await postRequest(c, pending.note);
    if (pending) accessCache.setPendingJoin(null);
    if (c !== bound) return false;
    apply(info);
    return info.status === "approved";
  } catch (e) {
    if (isLegacy(e)) {
      if (pending) accessCache.setPendingJoin(null);
      set({ status: "approved", info: null, checkedAt: Date.now() });
      return true;
    }
    if (e instanceof VibeError && e.status === 403 && isAccessCode(e.code)) return false;
    set({ checkedAt: Date.now() });
    return true;
  }
}

let inflight: Promise<void> | null = null;

export function refreshAccess(): Promise<void> {
  const c = bound;
  if (!c) return Promise.resolve();
  inflight ??= fetchInfo(c)
    .then(
      (info) => {
        if (c === bound) apply(info);
      },
      () => set({ checkedAt: Date.now() }),
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function accessDenied(code: string) {
  const next = statusFromCode(code);
  const cur = get();
  if (cur.status !== next) apply({ ...(cur.info ?? emptyInfo(next)), status: next, position: next === "waitlist" ? (cur.info?.position ?? null) : null });
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshAccess();
  }, 1500);
}

async function run(fn: (c: VibeClient) => Promise<AccessInfo>) {
  const c = bound;
  if (!c) throw new Error("not_connected");
  set({ busy: true });
  try {
    const info = await fn(c);
    if (c === bound) apply(info);
    return info;
  } finally {
    set({ busy: false });
  }
}

export function requestAccess(note = "") {
  return run((c) => postRequest(c, note));
}

export function leaveWaitlist() {
  return run(async (c) => parseInfo(await c.request<unknown>("DELETE", "/api/v1/access/request")) ?? emptyInfo("none"));
}

export function hasAccessClient() {
  return !!bound;
}
