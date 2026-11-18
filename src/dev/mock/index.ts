// Simuliertes Backend für Frontend-Entwicklung im Browser (VITE_MOCK=1). Nie im Produktions-Build.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import core from "./core";
import a from "./a";
import b from "./b";
import skins from "./skins";
import servers from "./servers";
import instancepage from "./instancepage";
import type { Handlers } from "./util";

mockWindows("main");

const handlers: Handlers = { ...core, ...a, ...b, ...skins, ...servers, ...instancepage };

mockIPC(
  async (cmd, args) => {
    const h = handlers[cmd];
    if (h) {
      // Etwas Latenz, damit Ladezustände sichtbar werden
      await new Promise((r) => setTimeout(r, 120));
      return h((args ?? {}) as Record<string, unknown>);
    }
    if (cmd.startsWith("plugin:")) return null;
    console.warn("[mock] kein Handler für", cmd, args);
    throw { kind: "error", message: `Mock: ${cmd} nicht simuliert` };
  },
  { shouldMockEvents: true },
);

console.info("[mock] simuliertes Backend aktiv");
