// Live-Updates der Cosmetics (im Shell eingehängt, damit Freigaben/Ablehnungen überall ankommen):
// `catalog.updated` (OTA: Katalog neu laden), `submission.updated` (Status + Hinweis), `loadout.updated` (z. B. im
// Spiel geändert).
import { useEffect } from "react";
import { toast } from "@/components/ui";
import { onGatewayEvent } from "@/features/social/service";
import { onCatalogUpdated, onLoadoutUpdated, onSubmissionUpdated } from "./data";

export function CosmeticsBridge() {
  useEffect(() => {
    const offs = [
      onGatewayEvent("catalog.updated", onCatalogUpdated),
      onGatewayEvent("submission.updated", (d) =>
        onSubmissionUpdated(d, (tone, title, text) => (tone === "error" ? toast.error(title, text) : tone === "success" ? toast.success(title, text) : toast.info(title, text))),
      ),
      onGatewayEvent("loadout.updated", onLoadoutUpdated),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  return null;
}
