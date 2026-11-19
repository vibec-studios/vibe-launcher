// Mock: Ankündigungen des Backends (`vibe_announcements`, docs/DOMAINS.md).
// Standard: nur `domain-move-2026-11` (das Backend schickt sie seit Migration 0008 nur noch an den Client).
// Screenshots: localStorage vl.mock.announcements = "demo" -> zusätzlich eine Warnung mit Link, "none" -> leer,
// "error" -> Abruf schlägt fehl (bleibt still).
import type { Announcement } from "@/lib/types";
import type { Handlers } from "./util";

function flag(): string | null {
  try {
    return localStorage.getItem("vl.mock.announcements");
  } catch {
    return null;
  }
}

const texts = {
  de: {
    move: { title: "Vibe zieht um", body: "Neue Adressen vibe.axolite.app und *.axolite.cc. Alte Adressen funktionieren vorerst weiter." },
    maint: { title: "Wartung am Samstag", body: "Freunde und Chats sind am Samstag zwischen 2 und 3 Uhr kurz nicht erreichbar." },
  },
  en: {
    move: { title: "Vibe is moving", body: "New addresses vibe.axolite.app and *.axolite.cc. Old addresses keep working for now." },
    maint: { title: "Maintenance on Saturday", body: "Friends and chats are briefly unavailable on Saturday between 2 and 3 am." },
  },
};

const handlers: Handlers = {
  vibe_announcements: ({ lang }) => {
    const f = flag();
    if (f === "error") throw { kind: "network", message: "Mock: Vibe-Server nicht erreichbar" };
    if (f === "none") return [];
    const tx = texts[lang === "en" ? "en" : "de"];
    const items: Announcement[] = [{ id: "domain-move-2026-11", level: "info", ...tx.move, url: "https://vibe.axolite.app" }];
    if (f === "demo") items.push({ id: "maintenance-mock", level: "warn", ...tx.maint, url: "https://status.axolite.app" });
    return items;
  },
};

export default handlers;
