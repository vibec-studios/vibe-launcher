import { create } from "zustand";
import { toast } from "@/components/ui";
import { t as tt } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { patchSettings } from "@/lib/mode";
import { qk, queryClient } from "@/lib/queries";
import type { DataEntry, DataPick, SettingsOffer } from "@/lib/types";

/** ID in `settings.dismissed_notices`: Hinweis erledigt oder abgelehnt. */
export const IMPORT_SETTINGS_NOTICE = "import-settings-2026-11";
/**
 * Eigene ID für fehlende Daten: Wer den Hinweis mit „Nie“ ausgeblendet hat, hat Einstellungen abgelehnt – fehlende
 * Daten (z. B. `xaero/` nach einem älteren NoRisk-Import, neue Welten) gab es damals nicht im Angebot. Der Hinweis
 * erscheint für diese Nutzer deshalb nur noch, wenn wirklich Daten fehlen, und zeigt dann nur die Daten.
 */
export const IMPORT_DATA_NOTICE = "import-data-2026-11";

export const pendingKey = ["import-settings", "pending"] as const;
export const offerKey = (id: string) => ["import-settings", "offer", id] as const;
/** Liste für eine Instanz (eigene Form: Array) – nicht mit `offerKey` (einzelnes Angebot) teilen. */
export const reviewKey = (id: string) => ["import-settings", "review", id] as const;

export interface ReviewState {
  open: boolean;
  /** null = alle importierten Instanzen (aus dem Hinweis) */
  instanceId: string | null;
  /** Hinweis in dieser Sitzung ausgeblendet („Nicht jetzt“ oder Liste geöffnet) */
  hintHidden: boolean;
}
export const useReview = create<ReviewState>(() => ({ open: false, instanceId: null, hintHidden: false }));

export function openSettingsReview(instanceId: string | null = null) {
  useReview.setState({ open: true, instanceId, hintHidden: true });
}

/** Ausgewählte Bereiche je Instanz (Standard: wie vom Backend vorgeschlagen). */
export const defaultsOf = (o: SettingsOffer) => o.changes.filter((c) => c.default_on).map((c) => c.key as string);
/** Gewählte Daten je Instanz: Pfad -> überschreiben? */
export type Picks = Record<string, boolean>;
/** Vorauswahl Daten: nur Fehlendes hinzufügen, nie überschreiben. */
export const dataDefaultsOf = (o: SettingsOffer): Picks => Object.fromEntries(o.data.filter((d) => d.default_on).map((d) => [d.path, false]));
export const toPicks = (p: Picks | undefined): DataPick[] => Object.entries(p ?? {}).map(([path, overwrite]) => ({ path, overwrite }));
/** Anzeigename eines Eintrags („Meine Welt“, „xaero/“, „options.txt“). */
export const dataLabel = (d: DataEntry) => (d.kind === "world" ? (d.name ?? d.path.replace(/^saves\//, "")) : d.kind === "dir" ? `${d.path}/` : d.path);

export function dismissNotice() {
  const s = queryClient.getQueryData<{ dismissed_notices?: string[] }>(qk.settings);
  const prev = s?.dismissed_notices ?? [];
  const add = [IMPORT_SETTINGS_NOTICE, IMPORT_DATA_NOTICE].filter((n) => !prev.includes(n));
  if (add.length) patchSettings({ dismissed_notices: [...prev, ...add] }).catch(() => {});
}

/** Übernehmen; gibt Anzahl erfolgreicher Instanzen zurück (Fehler als Toast). */
export async function applyAll(offers: SettingsOffer[], keys: Record<string, string[]>, data: Record<string, Picks>): Promise<number> {
  let ok = 0;
  let copying = 0;
  const errors: string[] = [];
  for (const o of offers) {
    const k = keys[o.instance_id] ?? [];
    const d = toPicks(data[o.instance_id]);
    if (!k.length && !d.length) continue;
    try {
      await api.importSettingsApply(o.instance_id, k, d);
      ok++;
      if (d.length) copying++;
    } catch (e) {
      errors.push(`${o.instance_name}: ${errorMessage(e)}`);
    }
  }
  queryClient.invalidateQueries({ queryKey: qk.instances });
  queryClient.invalidateQueries({ queryKey: ["import-settings"] });
  if (errors.length) toast.error(tt("isx.failed"), errors.join("\n"));
  else if (ok) {
    const one = offers.find((o) => (keys[o.instance_id]?.length ?? 0) + Object.keys(data[o.instance_id] ?? {}).length > 0);
    const what = ok === 1 && one ? tt("isx.done_1", { name: one.instance_name }) : tt("isx.done_n", { n: ok });
    toast.success(tt("isx.done"), copying ? `${what} · ${tt("isx.done_copying")}` : what);
  }
  return ok;
}
