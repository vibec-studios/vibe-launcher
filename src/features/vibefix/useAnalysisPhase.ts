import { useState } from "react";
import { useEvent } from "@/lib/events";
import type { VibeFixStatusEvent } from "@/lib/types";

export function useAnalysisPhase(): VibeFixStatusEvent | null {
  const [status, setStatus] = useState<VibeFixStatusEvent | null>(null);
  useEvent("vibefix://status", setStatus);
  return status;
}

export function isModelPhase(s: VibeFixStatusEvent | null): boolean {
  return s?.phase === "checking" || s?.phase === "downloading" || s?.phase === "loading";
}

export function phasePercent(s: VibeFixStatusEvent | null): number | null {
  if (!s || s.phase !== "downloading" || s.total <= 0) return null;
  return Math.min(100, Math.round((s.done / s.total) * 100));
}
