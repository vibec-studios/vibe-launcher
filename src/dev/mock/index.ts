// Simuliertes Backend für Frontend-Entwicklung im Browser (VITE_MOCK=1). Nie im Produktions-Build.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import core from "./core";
import a from "./a";
import b from "./b";
import skins from "./skins";
import servers from "./servers";
import instancepage from "./instancepage";
import home from "./home";
import social from "./social";
import clientpacks from "./clientpacks";
import play from "./play";
import announcements from "./announcements";
import cosmetics from "./cosmetics";
import importsettings from "./importsettings";
import modsets from "./modsets";
import bedrock from "./bedrock";
import feedback from "./feedback";
import clips from "./clips";
import userfixes from "./userfixes";
import many from "./many";
import appearance from "./appearance";
import organize from "./organize";
import portable from "./portable";
import worldPreview from "./world-preview";
import { withLiveModrinth } from "./modrinth-live";
import type { Handlers } from "./util";

if (location.pathname.endsWith("console.html")) mockWindows("console", "main");
else mockWindows("main");

const mockFlag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const base: Handlers = { ...core, ...a, ...b, ...skins, ...servers, ...instancepage, ...home, ...social, ...clientpacks, ...play, ...announcements, ...cosmetics, ...importsettings, ...modsets, ...bedrock, ...feedback, ...clips, ...userfixes, ...many, ...appearance, ...organize, ...portable };
Object.assign(base, worldPreview);
// „Neu prüfen“: Updates, Probleme und Modpack-Prüfung der übrigen Mocks bündeln (etwas länger, damit der
// Spinner am Knopf sichtbar ist; Screenshots: localStorage vl.mock.refresh = Millisekunden)
base.instance_refresh = async (args) => {
  await new Promise((r) => setTimeout(r, Number(mockFlag("vl.mock.refresh")) || 1800));
  const updates = (await base.content_check_updates(args)) as unknown[];
  return {
    items: 120,
    updates,
    update_error: null,
    modpack: await base.modpack_check(args),
    issues: await base.content_check_deps(args),
    checked_at: Date.now(),
  };
};

// VITE_MOCK_MODRINTH=live: Entdecken/Projektseite gegen die echte Modrinth-API
const handlers: Handlers = import.meta.env.VITE_MOCK_MODRINTH === "live" ? withLiveModrinth(base) : base;

// Screenshots (Lade-/Fehlerzustände): localStorage vl.mock.latency = Millisekunden je Command (Standard 120),
// vl.mock.fail = "cmd1,cmd2" -> diese Commands schlagen mit einer Netzwerk-Fehlermeldung fehl.
const latency = Number(mockFlag("vl.mock.latency")) || 120;
const failing = new Set((mockFlag("vl.mock.fail") ?? "").split(",").filter(Boolean));

mockIPC(
  async (cmd, args) => {
    if (cmd === "plugin:clipboard-manager|write_text") {
      return navigator.clipboard.writeText((args as { text: string }).text);
    }
    const h = handlers[cmd];
    if (h) {
      // Etwas Latenz, damit Ladezustände sichtbar werden (Settings/Instanzen immer schnell, sonst startet nichts)
      await new Promise((r) => setTimeout(r, cmd.startsWith("settings") || cmd === "system_info" ? 120 : latency));
      if (failing.has(cmd)) throw { kind: "network", message: "Keine Verbindung zum Server. Prüfe deine Internetverbindung." };
      return h((args ?? {}) as Record<string, unknown>);
    }
    if (cmd.startsWith("plugin:")) return null;
    console.warn("[mock] kein Handler für", cmd, args);
    throw { kind: "error", message: `Mock: ${cmd} nicht simuliert` };
  },
  { shouldMockEvents: true },
);

console.info("[mock] simuliertes Backend aktiv");
