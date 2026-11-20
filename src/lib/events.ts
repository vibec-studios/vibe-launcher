// Backend-Events (siehe src-tauri/src/events.rs).
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { Account, GameState, Instance, LogLine, ManualArrived, OfflineOffer, Server, ServerStatus, Settings, TaskInfo, VaultWarning, VibeWsEvent } from "./types";

export interface EventMap {
  "task://update": TaskInfo;
  "instance://changed": Instance;
  "instance://removed": { id: string };
  "game://state": GameState;
  "game://log": { instance_id: string; lines: LogLine[] };
  "content://changed": { instance_id: string };
  /** Manuell geladene Datei aus dem Download-Ordner übernommen */
  "content://manual-arrived": ManualArrived;
  "accounts://changed": Account[];
  "auth://vault-warning": VaultWarning;
  "auth://offline-available": OfflineOffer;
  "settings://changed": Settings;
  /** Clips (Vibey Client) geändert – nur solange `clipsWatch(true)` läuft */
  "clips://changed": { instance_ids: string[] };
  /** Skin-Bibliothek oder Skin/Cape eines Accounts geändert */
  "skins://changed": { scope: "library" } | { scope: "profile"; account_id: string };
  /** Server angelegt/geändert (vollständig) */
  "servers://changed": Server;
  "servers://removed": { id: string };
  /** Laufzeitstatus eines Servers (inkl. Tunnel) */
  "server://status": ServerStatus;
  /** Konsolenausgabe, gebündelt ≤10/s */
  "server://log": { server_id: string; lines: LogLine[] };
  /** Fenster soll schließen, aber Server laufen -> Frontend fragt und ruft api.serversQuit(stop) */
  "servers://close-requested": { running: number };
  /** WebSocket-Brücke des Vibe-Gateways (vibe/ws.rs) */
  "vibe://ws": VibeWsEvent;
}

export type EventName = keyof EventMap;

export function on<K extends EventName>(name: K, cb: (payload: EventMap[K]) => void): Promise<UnlistenFn> {
  return listen<EventMap[K]>(name, (e) => cb(e.payload));
}

/** Event abonnieren, solange die Komponente gemountet ist. Der Callback darf sich ändern. */
export function useEvent<K extends EventName>(name: K, cb: (payload: EventMap[K]) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    let un: UnlistenFn | undefined;
    let dead = false;
    on(name, (p) => ref.current(p)).then((u) => {
      if (dead) u();
      else un = u;
    });
    return () => {
      dead = true;
      un?.();
    };
  }, [name]);
}
