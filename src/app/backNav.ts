// „Zurück“ der ganzen App: Maus-Zurück-Taste (Button 3 / XButton1), Alt+Links und der Zurück-Knopf der Titelleiste.
// Overlays (z. B. die Projektansicht über „Entdecken“) können sich davorschalten und den Schritt selbst behandeln –
// dann schließt „Zurück“ nur das Overlay bzw. geht im Overlay einen Schritt zurück, statt die Seite zu verlassen.
import { router } from "./router";

type Handler = () => boolean;
const handlers: Handler[] = [];

/** Handler registrieren (zuletzt registrierter zuerst). Gibt `true` zurück, wenn der Schritt behandelt wurde. */
export function interceptBack(h: Handler): () => void {
  handlers.push(h);
  return () => {
    const i = handlers.lastIndexOf(h);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** Ein Schritt zurück: zuerst Overlays, sonst Browser-History. */
export function goBack() {
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]()) return;
  router.history.back();
}

export function goForward() {
  router.history.forward();
}

/** Gibt es ein offenes Overlay, das „Zurück“ selbst behandelt? */
export function hasBackInterceptor() {
  return handlers.length > 0;
}

/** Maus-Zurück/-Vor selbst ausführen (die WebView würde sonst eigenständig in der History springen). */
export function installMouseNav() {
  const isNav = (e: MouseEvent) => e.button === 3 || e.button === 4;
  // Standard-Navigation der WebView unterdrücken (passiert beim Loslassen)
  const block = (e: MouseEvent) => {
    if (isNav(e)) e.preventDefault();
  };
  document.addEventListener("mousedown", block);
  document.addEventListener("auxclick", block);
  document.addEventListener("mouseup", (e) => {
    if (!isNav(e)) return;
    e.preventDefault();
    if (e.button === 3) goBack();
    else goForward();
  });
}
