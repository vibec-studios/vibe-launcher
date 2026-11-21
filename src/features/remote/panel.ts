import { WEBSITE } from "@/lib/domains";
import { openExternal } from "@/components/content/util";
import { toast } from "@/components/ui";
import { t } from "@/i18n";
import type { RemoteAgent } from "./types";

export function panelUrl(a: RemoteAgent): string {
  if (a.via === "direct" && a.address) return `https://${a.address}/`;
  return `${WEBSITE}panel/#/a/${encodeURIComponent(a.id)}`;
}

export async function openAgentPanel(a: RemoteAgent) {
  await openExternal(panelUrl(a));
  if (a.via === "direct") toast.info(t("rmt.panel.web"), t("rmt.panel.cert"));
}
