import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { VibeClient } from "@/lib/vibe-sdk";
import { keyringTokenStore, tauriFetch } from "@/lib/vibe-sdk/tauri";
import { accessDenied, bindAccess, ensureAccess, onAccessChange } from "@/features/access/store";
import { isAccessCode } from "@/features/access/types";
import { autoLogin } from "./auth";
import { startGateway, stopGateway } from "./gateway";
import { pushPresence } from "./presence";
import { clearRetry, gatewayWanted, isLoopback, MAX_AUTO_TRIES, rt, type VibeConfig } from "./runtime";
import { empty, get, set, unlinkedScopes, type Conn } from "./store";

/** Vom VibeBridge bei jeder Änderung von Einstellungen/Account aufgerufen. */
export async function configure(next: VibeConfig) {
  rt.cfg = next;
  const seq = ++rt.cfgSeq;
  if (!next.enabled) {
    teardown("off");
    return;
  }
  let status;
  try {
    status = await api.vibeStatus();
  } catch {
    return;
  }
  // Inzwischen neuer Aufruf (z. B. schnelles Umschalten) -> der gewinnt
  if (seq !== rt.cfgSeq || !rt.cfg.enabled) return;
  const ident = status.identity;
  if (!ident) {
    teardown("no_account");
    return;
  }
  const key = `${status.api_url}|${ident.scope}`;
  if (key !== rt.clientKey || !rt.client) {
    teardown("logged_out");
    rt.clientKey = key;
    rt.tokens = keyringTokenStore();
    rt.client = new VibeClient({
      baseUrl: status.api_url,
      tokens: rt.tokens,
      fetch: accessFetch,
      timeoutMs: 20_000,
      onAuthLost: ({ message }) => {
        stopGateway();
        set({ conn: "logged_out", error: message, linked: false, ...empty });
        // z. B. Refresh-Token abgelaufen -> einmal still neu anmelden
        if (!get().unlinked && rt.autoTries < MAX_AUTO_TRIES) setTimeout(() => void autoLogin(), 1000);
      },
    });
    rt.autoTries = 0;
    clearRetry();
    bindAccess(rt.client, ident.scope);
    set({ identity: ident.name, scope: ident.scope, unlinked: unlinkedScopes().includes(ident.scope) });
  }
  // Debug-Offline-Testprofil (VIBE_DEV_OFFLINE_ACCOUNT) nur an einem lokalen Test-Backend automatisch anmelden –
  // nie am echten Backend (dort gibt es keinen Dev-Bypass, nur fehlschlagende Anmeldeversuche)
  rt.autoAllowed = !ident.dev || isLoopback(status.api_url);
  const loggedIn = await rt.client.isLoggedIn();
  if (seq !== rt.cfgSeq) return;
  if (!loggedIn) {
    if (get().conn === "logging_in") return;
    // Automatisch verbinden (einmal je Account und Sitzung; Netzwerkfehler -> später erneut)
    if (rt.autoAllowed && !get().unlinked && rt.autoTries < MAX_AUTO_TRIES && !rt.retryTimer) {
      void autoLogin();
      return;
    }
    if (!rt.retryTimer) set({ conn: "logged_out", linked: false });
    return;
  }
  set({ linked: true });
  if (!(await proceed(rt.client))) return;
  if (seq !== rt.cfgSeq) return;
  // Presence-Schalter geändert -> Status sofort anpassen
  pushPresence(true);
}

export async function proceed(c: VibeClient): Promise<boolean> {
  if (gatewayWanted() && get().conn !== "ready" && get().conn !== "no_access") set({ conn: "connecting" });
  const allowed = await ensureAccess(c);
  if (c !== rt.client) return false;
  if (!allowed) {
    blockServices();
    return false;
  }
  if (gatewayWanted()) startGateway();
  else {
    stopGateway();
    set({ conn: "off" });
  }
  return true;
}

export function blockServices() {
  stopGateway();
  queryClient.removeQueries({ queryKey: ["vibe"] });
  set({ conn: "no_access", error: null, ...empty });
}

const accessFetch: typeof fetch = async (input, init) => {
  const res = await tauriFetch(input, init);
  if (res.status === 403) {
    const code = await res
      .clone()
      .json()
      .then((j: { error?: { code?: unknown } }) => j?.error?.code)
      .catch(() => null);
    if (isAccessCode(code)) accessDenied(code);
  }
  return res;
};

onAccessChange((allowed) => {
  if (!rt.client || !get().linked) return;
  if (!allowed) {
    if (get().conn !== "no_access") blockServices();
    return;
  }
  if (get().conn !== "no_access") return;
  if (gatewayWanted()) startGateway();
  else set({ conn: "off" });
  pushPresence(true);
});

function teardown(conn: Conn) {
  stopGateway();
  clearRetry();
  rt.client = null;
  rt.clientKey = "";
  queryClient.removeQueries({ queryKey: ["vibe"] });
  const keep = conn !== "off" && conn !== "no_account";
  bindAccess(null, keep ? get().scope : null);
  set({ conn, error: null, ...empty, autoLinked: false, linked: false, identity: keep ? get().identity : null, scope: keep ? get().scope : null, unlinked: keep && get().unlinked });
}
