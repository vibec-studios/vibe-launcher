import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useVibe } from "@/lib/vibe";

/** Angemeldetes Vibe-Konto (nur wenn Vibe an ist), sonst null. */
export function useFeedbackAccount(): string | null {
  const vibe = useVibe();
  const status = useQuery({ queryKey: ["vibe-status-feedback"], queryFn: api.vibeStatus, enabled: vibe.enabled, staleTime: 30_000 });
  return vibe.enabled && status.data?.logged_in ? (status.data.identity?.name ?? null) : null;
}
