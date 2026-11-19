// „Neu prüfen“ in der Werkzeugleiste der Inhalte (neben Mod-Sets/Werkzeuge, auch im Simple-Modus und im Leerzustand):
// Inhaltsordner neu einlesen, Updates ohne Cache suchen und
// Probleme (Abhängigkeiten, Konflikte, Loader) neu berechnen. Zustand je Instanz (bleibt beim Tab-Wechsel erhalten):
// Ruhe -> läuft (Spinner) -> kurzes Ergebnis („Alles aktuell“ / „3 Updates · 1 Problem“), danach wieder Ruhe.
// Tastenkürzel F5 / Strg+R gelten auf der ganzen Instanzseite (sind global als Browser-Reload gesperrt, also frei).
import { AlertTriangle, ArrowUpCircle, Check, RefreshCw, WifiOff } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { Button, Spinner, Tooltip, cn, toast } from "@/components/ui";
import { markUpdatesChecked } from "@/features/content/contentView";
import { useT, t as tt } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";
import type { RefreshReport } from "@/lib/types";

export interface RefreshResult {
  updates: number | null;
  problems: number;
  errors: number;
}

interface Entry {
  phase: "running" | "done";
  result?: RefreshResult;
  /** Laufnummer: ein späterer Lauf beendet die Ergebnisanzeige eines früheren nicht */
  run: number;
}

const useRefresh = create<Record<string, Entry | undefined>>(() => ({}));
let runs = 0;
/** So lange bleibt das Ergebnis am Knopf stehen */
export const RESULT_MS = 6000;

/** Ergebnis in die Abfragen übernehmen (keine zweite Prüfung durch die Hinweiszeile/Inhalte). */
export function applyRefresh(id: string, r: RefreshReport) {
  if (r.updates) {
    queryClient.setQueryData(qk.contentUpdates(id), r.updates);
    markUpdatesChecked(id);
  }
  queryClient.setQueryData(["content", id, "deps"], r.issues);
  queryClient.setQueryData(["content", id, "modpack-check"], r.modpack);
  // Listen, manuelle Downloads usw. neu laden – nicht die eben gesetzten Daten
  void queryClient.invalidateQueries({
    predicate: (q) => q.queryKey[0] === "content" && q.queryKey[1] === id && q.queryKey[2] !== "deps" && q.queryKey[2] !== "modpack-check",
  });
  void queryClient.invalidateQueries({ queryKey: ["update-counts"] });
}

export async function refreshInstance(id: string): Promise<RefreshResult | null> {
  if (useRefresh.getState()[id]?.phase === "running") return null;
  const run = ++runs;
  useRefresh.setState({ [id]: { phase: "running", run } });
  try {
    const r = await api.instanceRefresh(id);
    applyRefresh(id, r);
    const result: RefreshResult = {
      updates: r.updates ? r.updates.length + (r.modpack ? 1 : 0) : null,
      problems: r.issues.length,
      errors: r.issues.filter((i) => i.severity === "error").length,
    };
    useRefresh.setState({ [id]: { phase: "done", result, run } });
    if (r.update_error) toast.error(r.update_error, tt("ipage.refresh.offline"));
    setTimeout(() => {
      if (useRefresh.getState()[id]?.run === run) useRefresh.setState({ [id]: undefined });
    }, RESULT_MS);
    return result;
  } catch (e) {
    useRefresh.setState({ [id]: undefined });
    toast.error(e, tt("ipage.refresh.failed"));
    return null;
  }
}

/** Kurztext des Ergebnisses: „Alles aktuell“, „3 Updates · 1 Problem“, „Updates nicht prüfbar · 1 Problem“. */
export function resultText(r: RefreshResult, t: ReturnType<typeof useT>): string {
  const parts: string[] = [];
  if (r.updates === null) parts.push(t("ipage.refresh.no_updates"));
  else if (r.updates > 0) parts.push(r.updates === 1 ? t("ipage.refresh.updates_1") : t("ipage.refresh.updates", { n: r.updates }));
  if (r.problems > 0) parts.push(r.problems === 1 ? t("ipage.refresh.problems_1") : t("ipage.refresh.problems", { n: r.problems }));
  return parts.length ? parts.join(" · ") : t("ipage.refresh.ok");
}

/** F5 / Strg+R auf der Instanzseite. */
export function useRefreshShortcut(id: string) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey) return;
      const k = e.key.toLowerCase();
      const hit = (k === "f5" && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === "r");
      if (!hit) return;
      // Offene Dialoge (z. B. „Probleme beheben“) nicht im Hintergrund verändern
      if (document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open]")) return;
      e.preventDefault();
      void refreshInstance(id);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [id]);
}

export function RefreshButton({ instanceId, variant = "toolbar", className }: { instanceId: string; variant?: "toolbar" | "empty"; className?: string }) {
  const bar = variant === "toolbar";
  const t = useT();
  const entry = useRefresh((s) => s[instanceId]);
  const running = entry?.phase === "running";
  const r = entry?.phase === "done" ? entry.result : undefined;
  const tone = !r ? null : r.errors > 0 ? "danger" : r.problems > 0 || r.updates === null ? "warn" : r.updates > 0 ? "accent" : "ok";
  const icon = running ? (
    <Spinner size={bar ? 12 : 14} />
  ) : !r ? (
    <RefreshCw size={bar ? 14 : 15} />
  ) : tone === "ok" ? (
    <Check size={bar ? 14 : 15} strokeWidth={2.5} className="text-ok" />
  ) : r.problems > 0 ? (
    <AlertTriangle size={bar ? 14 : 15} className={tone === "danger" ? "text-danger" : "text-warn"} />
  ) : r.updates === null ? (
    <WifiOff size={bar ? 14 : 15} className="text-warn" />
  ) : (
    <ArrowUpCircle size={bar ? 14 : 15} className="text-accent" />
  );
  return (
    // Ergebnis als kleine Blase unter dem Knopf: der Knopf behält seine Breite, der Kopf springt nicht
    <div className="relative shrink-0">
      <Tooltip content={r ? null : t("ipage.refresh.hint")} side="bottom">
        <Button
          variant={bar ? "subtle" : "ghost"}
          size={bar ? "sm" : "md"}
          aria-busy={running}
          aria-keyshortcuts="F5 Control+R"
          disabled={running}
          icon={icon}
          // Während des Laufs nicht ausgegraut (wirkt sonst wie „geht nicht“), nur nicht klickbar
          // Feste Mindestbreite: „Neu prüfen“ / „Prüfe …“ / „Geprüft“ verschieben die Leiste nicht
          className={cn(bar ? "min-w-[112px] justify-start px-2.5 data-[state=open]:bg-white/[.07]" : "min-w-[132px]", "disabled:opacity-100", r && bar && "text-text", className)}
          onClick={() => void refreshInstance(instanceId)}
        >
          {running ? t("ipage.refresh.running") : r ? t("ipage.refresh.done") : t("ipage.refresh")}
        </Button>
      </Tooltip>
      <div role="status" aria-live="polite" className={cn("pointer-events-none absolute top-full z-30 mt-2", bar ? "right-0" : "left-1/2 -translate-x-1/2")}>
        {r && (
          <div className="vl-bubble flex items-center gap-2 whitespace-nowrap rounded-ctl bg-overlay px-3 py-2 text-[13px] font-medium text-text shadow-e2">
            {icon}
            {resultText(r, t)}
          </div>
        )}
      </div>
    </div>
  );
}
