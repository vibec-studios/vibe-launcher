import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, EmptyState, Skeleton, Spinner } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import type { SettingsOffer } from "@/lib/types";
import { OfferCard } from "./OfferCard";
import { applyAll, dataDefaultsOf, defaultsOf, dismissNotice, pendingKey, reviewKey, useReview, type Picks } from "./state";

// ------------------------------------------------------------------ Liste „Ansehen“

export function SettingsReviewDialog() {
  const t = useT();
  const { open, instanceId } = useReview();
  const single = instanceId !== null;
  const q = useQuery({
    queryKey: single ? reviewKey(instanceId) : [...pendingKey, "review"],
    queryFn: async (): Promise<SettingsOffer[]> => (single ? [await api.importSettingsOffer(instanceId)].filter((o): o is SettingsOffer => !!o) : api.importSettingsPending()),
    enabled: open,
    staleTime: 0,
    retry: 0,
  });
  const offers = useMemo(() => (q.data ?? []).filter((o) => o.changes.length || o.data.length), [q.data]);
  const [keys, setKeys] = useState<Record<string, string[]>>({});
  const [data, setData] = useState<Record<string, Picks>>({});
  const [busy, setBusy] = useState(false);
  const { data: instances = [] } = useInstances();

  // Neue Daten -> Vorauswahl
  useEffect(() => {
    if (!q.data) return;
    setKeys(Object.fromEntries(q.data.map((o) => [o.instance_id, defaultsOf(o)])));
    setData(Object.fromEntries(q.data.map((o) => [o.instance_id, dataDefaultsOf(o)])));
  }, [q.data]);

  const close = () => useReview.setState({ open: false });
  const count = Object.values(keys).reduce((n, k) => n + k.length, 0) + Object.values(data).reduce((n, d) => n + Object.keys(d).length, 0);
  const toggle = (id: string, k: string, on: boolean) => setKeys((s) => ({ ...s, [id]: on ? [...new Set([...(s[id] ?? []), k])] : (s[id] ?? []).filter((x) => x !== k) }));
  const pick = (id: string, path: string, v: boolean | null) =>
    setData((s) => {
      const cur = { ...(s[id] ?? {}) };
      if (v === null) delete cur[path];
      else cur[path] = v;
      return { ...s, [id]: cur };
    });
  const apply = async () => {
    setBusy(true);
    const ok = await applyAll(offers, keys, data);
    setBusy(false);
    if (ok) {
      if (!single) dismissNotice();
      close();
    }
  };

  const launcher = offers[0]?.launcher_name ?? "";
  let body;
  if (q.isPending) {
    body = (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Spinner /> {t("isx.loading")}
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[96px]" />
        ))}
      </div>
    );
  } else if (q.isError) {
    body = <EmptyState icon="error" title={t("isx.failed")} text={errorMessage(q.error)} className="py-10" />;
  } else if (!offers.length) {
    body = <EmptyState icon="clock" title={t("isx.empty_title")} text={t("isx.empty_text")} className="py-10" />;
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {offers.map((o) => (
          <OfferCard
            key={o.instance_id}
            offer={o}
            instance={instances.find((i) => i.id === o.instance_id)}
            single={single}
            keys={keys[o.instance_id] ?? []}
            picks={data[o.instance_id] ?? {}}
            onKey={(k, on) => toggle(o.instance_id, k, on)}
            onPick={(path, v) => pick(o.instance_id, path, v)}
            onAll={(on) => {
              setKeys((s) => ({ ...s, [o.instance_id]: on ? o.changes.map((c) => c.key) : [] }));
              setData((s) => ({ ...s, [o.instance_id]: on ? { ...dataDefaultsOf(o), ...(s[o.instance_id] ?? {}) } : {} }));
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      size="lg"
      locked={busy}
      title={single && launcher ? t("isx.title_one", { launcher }) : t("isx.title")}
      description={t("isx.desc")}
      footer={
        <>
          <Button variant="subtle" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={count === 0} onClick={() => void apply()}>
            {count === 1 ? t("isx.apply_1") : count > 1 ? t("isx.apply_n", { n: count }) : t("isx.apply_none")}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}
