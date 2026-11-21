import type { FeedbackPreview, FeedbackSendResult } from "@/lib/types";

export const MIN = 10;
export const MAX = 5000;
export const CONTACT_MAX = 200;

export type Step = { s: "edit" } | { s: "preview"; p: FeedbackPreview; error: FeedbackSendResult | null } | { s: "done"; ticket: string };

export function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "vibe.axolite.app";
  }
}
