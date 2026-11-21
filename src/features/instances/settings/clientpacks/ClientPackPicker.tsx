import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { LoaderKind } from "@/lib/types";
import { ErrorState, Select } from "@/components/ui";
import { useT } from "@/i18n";
import { cpk, offeredPack, packName } from "./logic";

// ------------------------------------------------------------------ Auswahl beim Erstellen

/** Kompakte Pack-Auswahl für „Neue Instanz“ (nur Packs, die zu Version + Loader passen). */
export function ClientPackPicker({ mc, loader, value, onChange }: { mc: string | null; loader: LoaderKind; value: string | null; onChange: (id: string | null) => void }) {
  const t = useT();
  const q = useQuery({
    queryKey: cpk.plan(mc ?? "", loader),
    queryFn: () => api.clientPacksList({ mcVersion: mc!, loader }),
    enabled: !!mc && loader !== "vanilla",
    staleTime: 5 * 60_000,
  });
  const packs = (q.data?.packs ?? []).filter(offeredPack);
  const selected = packs.find((p) => p.id === value);
  useEffect(() => {
    if (value && q.data && selected?.available !== true) onChange(null);
  }, [value, q.data, selected, onChange]);
  return (
    <div className="flex flex-col gap-2">
      <Select<string>
        value={value ?? "none"}
        disabled={loader === "vanilla" || !mc || q.isPending}
        onChange={(v) => onChange(v === "none" ? null : v)}
        options={[
          { value: "none", label: t("cp.new.none") },
          ...packs.map((p) => ({
            value: p.id,
            label: packName(t, p.id),
            hint: p.available === true ? t(`cp.badge.${p.category}`) : p.available === null ? t("cp.reason.unreachable") : t("cp.new.unavailable"),
            disabled: p.available !== true,
          })),
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : selected ? (
        <p className="text-[14px] text-muted">{t(`cp.${selected.id}.desc`)}</p>
      ) : null}
    </div>
  );
}
