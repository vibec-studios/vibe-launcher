// Client-Packs: Karten (Name, Kurzbeschreibung, Badge Offiziell/Community, Herkunft bei Community-Packs) mit
// Installieren/Aktualisieren/Entfernen. Clients schließen sich aus: Beim Wechsel wird nach Bestätigung das alte
// Pack entfernt (Backend `client_pack_install` mit `replace`). Keine fremden Logos/Brandings – neutrale Icons.
// `ClientPackPicker` ist die kompakte Auswahl im Dialog „Neue Instanz“.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { isRunning, useGameState } from "@/lib/queries";
import type { ClientPackOffer, Instance } from "@/lib/types";
import { Skeleton, cn, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { confirmSwitch, cpk, installPack, offeredPack, packName, useClientPacks } from "./clientpacks/logic";
import { PackCard } from "./clientpacks/PackCard";

export { confirmSwitch, cpk, installPack, installPackAfterCreate, offeredPack, packName, useClientPacks } from "./clientpacks/logic";
export { ClientPackPicker } from "./clientpacks/ClientPackPicker";

export function ClientPacks({ instance, only, compact }: { instance: Instance; only?: string[]; compact?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useClientPacks(instance);
  const running = isRunning(useGameState(instance.id));
  const [busy, setBusy] = useState<string | null>(null);

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 max-[980px]:grid-cols-1">
        {Array.from({ length: only?.length ?? 4 }, (_, i) => (
          <Skeleton key={i} className="h-[168px]" />
        ))}
      </div>
    );
  }
  if (!q.data) return <p className="px-1 text-[13px] text-danger">{errorMessage(q.error)}</p>;
  const data = q.data;
  const visible = data.packs.filter((p) => (!only || only.includes(p.id)) && offeredPack(p));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: cpk.instance(instance.id) });
  };
  const run = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await f();
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const remove = async (o: ClientPackOffer) => {
    const name = packName(t, o.id);
    const ok = await confirm({ title: t("cp.remove.title", { name }), text: t("cp.remove.text"), confirmLabel: t("cp.remove"), danger: true });
    if (!ok) return;
    await run(o.id, async () => {
      try {
        await api.clientPackRemove(instance.id, o.id);
        toast.success(t("cp.removed", { name }));
      } catch (e) {
        toast.error(e, t("cp.remove_failed", { name }));
      }
    });
  };

  const groups: { key: "official" | "community"; items: ClientPackOffer[] }[] = (["official", "community"] as const)
    .map((key) => ({ key, items: visible.filter((p) => p.category === key) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-2">
          {!compact && <h3 className="text-[16px] font-semibold text-text">{t(`cp.group.${g.key}`)}</h3>}
          {/* Ein einzelnes Pack nimmt die ganze Breite statt einer halben Kachel */}
          <div className={cn("grid gap-3", compact || g.items.length === 1 ? "grid-cols-1" : "grid-cols-2 max-[980px]:grid-cols-1")}>
            {g.items.map((o) => (
              <PackCard
                key={o.id}
                offer={o}
                data={data}
                busy={busy === o.id}
                locked={running || (busy !== null && busy !== o.id)}
                running={running}
                onInstall={async () => {
                  const replace = await confirmSwitch(t, o, data.packs);
                  if (replace !== null) await run(o.id, () => installPack(t, instance.id, o, replace));
                }}
                onRemove={() => remove(o)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
