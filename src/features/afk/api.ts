import { invoke } from "@tauri-apps/api/core";
import type { AfkEvent, AfkSession, AfkSupport } from "./types";

export const afkApi = {
  support: (instanceId: string) => invoke<AfkSupport>("afk_support", { instanceId }),
  sessions: () => invoke<AfkSession[]>("afk_sessions"),
  events: (runId: string) => invoke<AfkEvent[]>("afk_events", { runId }),
  setBackground: (runId: string, background: boolean) => invoke<AfkSession>("afk_set_background", { runId, background }),
  send: (runId: string, text: string) => invoke<string>("afk_send", { runId, text }),
};
