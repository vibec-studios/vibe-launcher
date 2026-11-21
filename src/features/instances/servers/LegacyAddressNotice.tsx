import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance, ServerEntry } from "@/lib/types";
import { Button, Tooltip, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { isLegacyRelayAddress } from "@/lib/domains";
import { key } from "./keys";

/** Domain-Umzug: Hinweis bei Adressen `*.vibey.henny.dev` mit Knopf „Auf .axolite.cc umstellen“ (gleicher Name). */
export function LegacyAddressNotice({ instance, list, locked }: { instance: Instance; list: ServerEntry[]; locked: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const n = list.filter((s) => isLegacyRelayAddress(s.ip)).length;
  if (!n) return null;
  const run = async () => {
    setBusy(true);
    try {
      await api.instanceServersModernize(instance.id);
      toast.success(t("notice.servers.done"));
    } catch (e) {
      toast.error(e, t("notice.servers.failed"));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: key(instance.id) });
    }
  };
  return (
    <div role="status" className="mx-6 mb-2 flex items-center gap-3 rounded-card bg-brand/[.07] px-3.5 py-2.5">
      <Info size={16} className="shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-text">{t("notice.servers.title")}</div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{n === 1 ? t("notice.servers.text_one") : t("notice.servers.text_many", { n })}</p>
      </div>
      <Tooltip content={locked ? t("servers.locked") : null}>
        <span>
          <Button size="sm" variant="accent" loading={busy} disabled={locked || busy} onClick={run}>
            {t("notice.servers.action")}
          </Button>
        </span>
      </Tooltip>
    </div>
  );
}
