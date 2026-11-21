// Typisierte Wrapper für alle Tauri-Commands. Argumentnamen: Tauri erwartet camelCase im JS
// für snake_case-Parameter in Rust (z. B. `instance_id` -> `instanceId`).
import { invoke } from "@tauri-apps/api/core";
import { routeRemote } from "@/features/remote/dispatch";
import type { AppError } from "../types";

export function call<R>(cmd: string, args?: Record<string, unknown>): Promise<R> {
  return routeRemote<R>(cmd, args) ?? invoke<R>(cmd, args);
}

/** Fehler aus dem Backend in lesbaren Text umwandeln. */
export function errorMessage(e: unknown): string {
  if (!e) return "Unbekannter Fehler";
  if (typeof e === "string") return e;
  if (typeof e === "object" && "message" in (e as object)) return String((e as { message: unknown }).message);
  return String(e);
}

export function isCancelled(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as AppError).kind === "cancelled";
}
