// Verhalten wie eine native App: kein Browser-Kontextmenü, keine Reload-/Zoom-/Druck-Tastenkürzel,
// kein Ziehen von Bildern/Links, kein Zoom per Strg+Mausrad.
import { openTextMenu } from "./TextMenu";
import { goBack, hasBackInterceptor, installMouseNav } from "./backNav";

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled;
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    return !el.disabled && ["text", "search", "url", "email", "password", "number", ""].includes(t);
  }
  return el.isContentEditable;
}

export function installGuards() {
  // Rechtsklick: eigene Menüs (Radix) haben schon preventDefault gesetzt. Für Eingabefelder und
  // markierbaren Text zeigen wir ein eigenes Text-Menü, sonst gar nichts.
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const target = e.target as HTMLElement | null;
    if (isEditable(target)) {
      openTextMenu(e.clientX, e.clientY, target as HTMLElement, true);
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && target?.closest(".selectable")) {
      openTextMenu(e.clientX, e.clientY, null, false);
    }
  });

  document.addEventListener(
    "keydown",
    (e) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const blocked =
        k === "f5" ||
        k === "f7" ||
        k === "f3" ||
        (!import.meta.env.DEV && k === "f12") ||
        (mod && ["r", "p", "s", "u", "g", "j", "o", "n", "+", "-", "=", "0"].includes(k)) ||
        (mod && k === "f" && !(e.target instanceof HTMLElement && e.target.dataset.allowFind)) ||
        (mod && e.shiftKey && ["i", "j", "c", "r", "delete"].includes(k) && !import.meta.env.DEV) ||
        (e.altKey && (k === "arrowleft" || k === "arrowright") && !isEditable(e.target)) ||
        (k === "backspace" && !isEditable(e.target));
      if (blocked) e.preventDefault();
      // Alt+Links: nur wenn ein Overlay „Zurück“ selbst behandelt (schließt es bzw. geht darin zurück)
      if (e.altKey && k === "arrowleft" && !isEditable(e.target) && hasBackInterceptor()) goBack();
    },
    { capture: true },
  );

  // Strg + Mausrad / Pinch-Zoom verhindern
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );

  // Ziehen von Bildern/Links/Text verhindern (eigenes DnD nutzt draggable="true")
  document.addEventListener("dragstart", (e) => {
    const el = e.target as HTMLElement | null;
    if (!el || !(el.closest?.("[draggable='true']"))) e.preventDefault();
  });

  // Maus-Zurück/-Vor (Button 3/4): eigene History-Navigation, Overlays zuerst
  installMouseNav();

  // Mittlere Maustaste öffnet keine neuen Fenster, Auto-Scroll aus
  document.addEventListener("auxclick", (e) => {
    if (e.button === 1) e.preventDefault();
  });
  document.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault();
  });

  // Links mit target=_blank / externe URLs im Systembrowser öffnen
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault();
      import("@tauri-apps/plugin-opener").then((m) => m.openUrl(href)).catch(() => {});
    }
  });
}
