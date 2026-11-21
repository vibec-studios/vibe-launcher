import { getVersion } from "@tauri-apps/api/app";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { VibeError } from "@/lib/vibe-sdk";
import { t } from "@/i18n";
import { clearAccess, forgetAccess } from "@/features/access/store";
import { stopGateway } from "./gateway";
import { proceed } from "./lifecycle";
import { pushPresence } from "./presence";
import { clearRetry, errText, requireClient, rt } from "./runtime";
import { empty, get, set, setUnlinked } from "./store";

// ------------------------------------------------------------------ Anmelden / Verknüpfung

/** Automatische Anmeldung, sobald ein Microsoft-Account da ist (kein Klick nötig). */
export async function autoLogin() {
  const c = rt.client;
  if (!c || !rt.autoAllowed || get().unlinked || get().conn === "logging_in" || !rt.cfg.enabled) return;
  rt.autoTries++;
  try {
    await login();
    clearRetry();
    if (c === rt.client) set({ autoLinked: true });
  } catch (e) {
    if (c !== rt.client) return;
    // Server nicht erreichbar -> später still erneut versuchen (zählt nicht als Fehlversuch)
    if (e instanceof VibeError && e.status === 0) {
      rt.autoTries--;
      set({ conn: "offline", error: null });
      rt.retryTimer = setTimeout(() => {
        rt.retryTimer = null;
        void autoLogin();
      }, rt.retryDelay);
      rt.retryDelay = Math.min(rt.retryDelay * 2, 5 * 60_000);
    }
  }
}

/** Bewusstes „Verbinden“ (z. B. nach „Verknüpfung lösen“): schaltet das automatische Verbinden wieder ein. */
export async function connect() {
  const scope = get().scope;
  if (scope) setUnlinked(scope, false);
  clearRetry();
  rt.autoTries = 0;
  set({ autoLinked: false });
  await login();
}

/** „Verknüpfung lösen“: am Backend abmelden, Tokens löschen, kein automatisches Verbinden mehr für diesen Account. */
export async function unlink() {
  const scope = get().scope;
  if (scope) setUnlinked(scope, true);
  clearRetry();
  await logout();
}

/** „Vibe-Konto löschen“ (`DELETE /api/v1/me`), danach lokal wie „Verknüpfung lösen“. */
export async function deleteAccount() {
  const c = requireClient();
  const scope = get().scope;
  const was = get().unlinked;
  // Vorher sperren: Das Backend schließt das Gateway (4010) evtl. noch vor der HTTP-Antwort
  if (scope) setUnlinked(scope, true);
  try {
    await c.request<void>("DELETE", "/api/v1/me", { body: { confirm: true } });
  } catch (e) {
    if (scope) setUnlinked(scope, was);
    throw e;
  }
  clearRetry();
  stopGateway();
  forgetAccess();
  await Promise.resolve(rt.tokens.set(null)).catch(() => {});
  queryClient.removeQueries({ queryKey: ["vibe"] });
  set({ conn: "logged_out", error: null, autoLinked: false, linked: false, ...empty });
}

/** Anmeldung über Mojang-join (automatisch oder per Klick). */
export async function login() {
  const c = rt.client;
  if (!c) throw new Error(t("social.err.not_connected"));
  set({ conn: "logging_in", error: null });
  try {
    const status = await api.vibeStatus();
    const name = status.identity?.name;
    if (!name) throw new Error(t("social.err.no_account"));
    const version = await getVersion().catch(() => "1.0.0");
    await c.auth.login({
      name,
      client: { name: "vibe-launcher", version, platform: "windows" },
      joinServer: async (serverId) => {
        await api.vibeMojangJoin(serverId);
      },
    });
    set({ linked: true });
  } catch (e) {
    set({ conn: "logged_out", error: errText(e) });
    throw e;
  }
  if (await proceed(c)) pushPresence(true);
}

export async function logout() {
  const c = rt.client;
  stopGateway();
  clearAccess();
  try {
    await c?.auth.logout();
  } catch {
    await Promise.resolve(rt.tokens.set(null)).catch(() => {});
  }
  queryClient.removeQueries({ queryKey: ["vibe"] });
  set({ conn: "logged_out", error: null, autoLinked: false, linked: false, ...empty });
}
