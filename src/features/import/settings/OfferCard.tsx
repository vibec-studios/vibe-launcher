import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Checkbox, cn } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useT } from "@/i18n";
import { instanceAccent } from "@/lib/format";
import type { DataEntry, Instance, SettingsOffer } from "@/lib/types";
import { ChangeRow, DataRow } from "./rows";
import type { Picks } from "./state";

export function OfferCard({
  offer: o,
  instance,
  single,
  keys,
  picks,
  onKey,
  onPick,
  onAll,
}: {
  offer: SettingsOffer;
  instance: Instance | undefined;
  single: boolean;
  keys: string[];
  picks: Picks;
  onKey: (k: string, on: boolean) => void;
  onPick: (path: string, overwrite: boolean | null) => void;
  onAll: (on: boolean) => void;
}) {
  const t = useT();
  const defaultData = o.data.filter((d) => d.default_on);
  const total = o.changes.length + defaultData.length;
  const chosen = o.changes.filter((c) => keys.includes(c.key)).length + defaultData.filter((d) => d.path in picks).length;
  const all = total > 0 && chosen === total;
  const some = !all && chosen > 0;
  return (
    <section className="flex flex-col rounded-card bg-white/[.03]">
      {!single && (
        <header className="flex items-center gap-3 px-3 pb-1 pt-3">
          <Checkbox checked={all} mixed={some} onChange={onAll} label={o.instance_name} />
          <InstanceIcon icon={instance?.icon ?? null} seed={o.instance_id} accent={instanceAccent(o.instance_id, instance?.accent ?? null)} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-text">{o.instance_name}</div>
            <div className="truncate text-[12px] text-dim">{t("isx.from", { launcher: o.launcher_name })}</div>
          </div>
        </header>
      )}
      {o.changes.length > 0 && (
        <div className="flex flex-col py-1.5">
          {o.changes.map((c) => (
            <ChangeRow key={c.key} change={c} launcher={o.launcher_name} on={keys.includes(c.key)} onChange={(on) => onKey(c.key, on)} />
          ))}
        </div>
      )}
      {o.notes.map((n) => (
        <p key={n} className="flex items-start gap-1.5 px-3 pb-2 text-[12px] text-dim">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {n}
        </p>
      ))}
      {o.data.length > 0 && <DataSection offer={o} picks={picks} onPick={onPick} divider={o.changes.length > 0} />}
    </section>
  );
}

/** Wie viele Einträge vor „Alle anzeigen“ */
export const DATA_PREVIEW = 8;

export function DataSection({ offer: o, picks, onPick, divider }: { offer: SettingsOffer; picks: Picks; onPick: (path: string, overwrite: boolean | null) => void; divider: boolean }) {
  const t = useT();
  const [more, setMore] = useState(false);
  const entries = o.data;
  const shown = more ? entries : entries.slice(0, DATA_PREVIEW);
  const worlds = shown.filter((d) => d.kind === "world");
  const other = shown.filter((d) => d.kind !== "world");
  const row = (d: DataEntry) => <DataRow key={d.path} entry={d} launcher={o.launcher_name} pick={picks[d.path]} onPick={(v) => onPick(d.path, v)} />;
  return (
    <div className={cn("mx-3 mb-3 flex flex-col gap-0.5", divider ? "mt-1 border-t border-line pt-3" : "mt-3")}>
      <div className="text-[12.5px] font-semibold text-text">{t("isx.data.title")}</div>
      <p className="pb-1 text-[12px] leading-snug text-dim">{t("isx.data.desc", { launcher: o.launcher_name })}</p>
      {other.map(row)}
      {worlds.length > 0 && <div className="px-1 pb-0.5 pt-2 text-caption font-semibold uppercase tracking-wide text-dim">{t("isx.data.worlds")}</div>}
      {worlds.map(row)}
      {entries.length > DATA_PREVIEW && (
        <button type="button" onClick={() => setMore((m) => !m)} className="mt-1 self-start rounded-ctl px-1 text-[12px] font-medium text-brand hover:underline">
          {more ? t("isx.data.less") : t("isx.data.more", { n: entries.length })}
        </button>
      )}
    </div>
  );
}
