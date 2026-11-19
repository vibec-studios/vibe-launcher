// Aktionen aus dem Frontend selbst (z. B. eingefügter Einladungslink) in dieselbe Warteschlange wie Deep-Links
// (`ActionHost`) stellen – mit denselben Rückfragen.
import type { AppAction } from "./types";

const listeners = new Set<(a: AppAction) => void>();

export function enqueueAppAction(a: AppAction) {
  for (const l of listeners) l(a);
}

export function onAppAction(l: (a: AppAction) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
