import { createGatewayAccount, type AccountApi } from "@/api/gateway";
import { createLocalTransport } from "@/api/local";
import type { Transport } from "@/api/transport";

export type PanelMode = "local" | "gateway";

export const IS_MOCK = import.meta.env.VITE_MOCK === "1";

const MODE_KEY = "vibe-panel.mode";

export function detectMode(): PanelMode {
  const q = new URLSearchParams(location.search).get("mode");
  if (q === "local" || q === "gateway") {
    try {
      sessionStorage.setItem(MODE_KEY, q);
    } catch {
      /* privat */
    }
    return q;
  }
  try {
    const s = sessionStorage.getItem(MODE_KEY);
    if (s === "local" || s === "gateway") return s;
  } catch {
    /* privat */
  }
  const env = import.meta.env.VITE_PANEL_MODE as string | undefined;
  if (env === "local" || env === "gateway") return env;
  return location.pathname.startsWith("/panel") ? "gateway" : "local";
}

type MockModule = typeof import("@/api/mock");
let mock: MockModule | null = null;

export async function initRuntime() {
  if (IS_MOCK) {
    mock = await import("@/api/mock");
    mock.consumeMockLoginRedirect();
  }
}

export function localTransport(token: string | null, onUnauthorized: () => void): Transport {
  if (mock) return mock.createMockTransport("home");
  return createLocalTransport(token, onUnauthorized);
}

export function accountApi(onUnauthorized: () => void): AccountApi {
  if (mock) return mock.createMockAccount();
  return createGatewayAccount(onUnauthorized);
}
