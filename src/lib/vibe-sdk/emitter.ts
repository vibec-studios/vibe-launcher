// Übernommen aus @vibe-craft/sdk 0.1.0 (vibe-backend/packages/sdk/src/emitter.ts, MIT). Nur Importpfade angepasst.
/** Minimaler, typisierter Event-Emitter ohne Abhängigkeiten. */
export class Emitter<Events extends object> {
  private handlers = new Map<keyof Events, Set<(payload: any) => void>>();

  /** Abonnieren; gibt eine Funktion zum Abmelden zurück. */
  on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => this.off(event, fn);
  }

  once<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): () => void {
    const off = this.on(event, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void) {
    this.handlers.get(event)?.delete(fn);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]) {
    for (const fn of [...(this.handlers.get(event) ?? [])]) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[vibe-sdk] Handler für "${String(event)}" warf einen Fehler`, e);
      }
    }
  }

  removeAllListeners() {
    this.handlers.clear();
  }
}
