import { WifiOff } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, toast } from "@/components/ui";
import { t as tr, useT } from "@/i18n";
import { api } from "@/lib/api";
import { useEvent } from "@/lib/events";
import { qk, queryClient } from "@/lib/queries";
import type { Account, OfflineOffer } from "@/lib/types";

function accountName(offer: OfflineOffer): string {
  const list = queryClient.getQueryData<Account[]>(qk.accounts) ?? [];
  const acc = list.find((a) => (offer.account_id ? a.id === offer.account_id : a.active));
  return acc?.username ?? "Minecraft";
}

export function AuthBridge() {
  const t = useT();
  const [offer, setOffer] = useState<OfflineOffer | null>(null);
  const [busy, setBusy] = useState(false);

  useEvent("auth://vault-warning", (w) => toast.info(tr("accounts.vault.title"), tr("accounts.vault.text", { name: w.username }), undefined, 15000));
  useEvent("auth://offline-available", (o) => setOffer(o));

  const start = async () => {
    if (!offer) return;
    setBusy(true);
    try {
      await api.instanceLaunch(offer.instance_id, offer.account_id, null, null, true);
      setOffer(null);
    } catch (e) {
      toast.error(e, t("accounts.offline.failed"));
    } finally {
      setBusy(false);
    }
  };

  const name = offer ? accountName(offer) : "";
  return (
    <Dialog
      open={!!offer}
      onOpenChange={(o) => !o && !busy && setOffer(null)}
      title={t("accounts.offline.title")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={() => setOffer(null)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<WifiOff size={14} />} onClick={() => void start()} loading={busy} autoFocus>
            {t("accounts.offline.start")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] text-muted">
        <p>{t("accounts.offline.text", { name })}</p>
        <p className="text-text">{t("accounts.offline.single", { name })}</p>
        <div className="rounded-card bg-warn/10 px-3.5 py-2.5 text-[12.5px] text-text">{t("accounts.offline.no_mp")}</div>
      </div>
    </Dialog>
  );
}
