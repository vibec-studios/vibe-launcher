import { call } from "@/lib/api/call";

export interface LeanRestore {
  route: string | null;
  reason: "user" | "game_ended" | "crash";
  instance_id: string | null;
}

export const leanApi = {
  handoff: (route: string | null) => call<void>("lean_handoff", { route }),
  restoreTake: () => call<LeanRestore | null>("lean_restore_take"),
};
