import { useVibe } from "@/lib/vibe";
import { useSocial } from "@/features/social/service";

export function useShotSharing() {
  const vibe = useVibe();
  const linked = useSocial((s) => s.linked);
  return vibe.social && linked;
}
