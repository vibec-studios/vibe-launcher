// OWNER: Content-Agent. „Mit Mod-Sets starten“ im Neue-Instanz-Dialog: Mehrfachauswahl + Verfügbarkeit für die
// gewählte Version/den Loader. Nach dem Anlegen installiert `installSetsAfterCreate` alles Passende.
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Layers } from "lucide-react";
import { Checkbox, Spinner, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { queryClient, waitForTask } from "@/lib/queries";
import type { LoaderKind } from "@/lib/types";
import { setsApi, useSets } from "./api";
import { SetCover, countLabel } from "./shared";

export function useNewInstanceSets() {
  const sets = useSets();
  const [selection, setSelection] = useState<string[] | null>(null);
  const usable = (sets.data ?? []).filter((s) => s.entries.length > 0);
  const setIds = selection === null
    ? usable.filter((s) => s.apply_on_create).map((s) => s.id)
    : selection.filter((id) => usable.some((s) => s.id === id));
  return { setIds, setSetIds: setSelection, setsLoading: sets.isPending && !sets.isError };
}

export function useSetCheck(setIds: string[], mc: string | null, loader: LoaderKind) {
  return useQuery({
    queryKey: ["mod-sets", "check", [...setIds].sort(), mc, loader],
    queryFn: () => setsApi.check(setIds, mc!, loader),
    enabled: setIds.length > 0 && !!mc,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}

export function SetPicker({ mc, loader, value, onChange }: { mc: string | null; loader: LoaderKind; value: string[]; onChange: (ids: string[]) => void }) {
  const t = useT();
  const sets = (useSets().data ?? []).filter((s) => s.entries.length > 0);
  const check = useSetCheck(value, mc, loader);
  const chosen = sets.filter((s) => value.includes(s.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const label = chosen.length === 0 ? t("newinst.sets_none") : chosen.length === 1 ? chosen[0].name : t("newinst.sets_n", { n: chosen.length });
  return (
    <div className="flex flex-col gap-1">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            disabled={!sets.length}
            className="flex min-h-10 w-full items-center justify-between gap-2 rounded-ctl bg-field px-3 text-left text-[14px] text-text outline-none transition-colors hover:bg-surface2 focus-visible:ring-1 focus-visible:ring-accent/70 disabled:opacity-50 data-[state=open]:bg-surface2"
          >
            <span className={cn("flex min-w-0 items-center gap-2", !chosen.length && "text-dim")}>
              <Layers size={14} className="shrink-0 text-dim" />
              <span className="truncate">{sets.length ? label : t("newinst.sets_none")}</span>
            </span>
            <ChevronDown size={14} className="shrink-0 text-dim" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={6} collisionPadding={12} className="scroll z-[70] max-h-[var(--radix-popover-content-available-height)] w-[min(360px,var(--radix-popover-content-available-width))] rounded-card border border-line bg-overlay p-2 shadow-e2 outline-none">
            {sets.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-ctl px-2 py-2.5 hover:bg-surface2">
                <Checkbox checked={value.includes(s.id)} onChange={() => toggle(s.id)} label={s.name} />
                <button type="button" tabIndex={-1} onClick={() => toggle(s.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <SetCover set={s} size={28} />
                  <span className="min-w-0">
                    <span className="block break-words text-[15px] font-semibold text-text">{s.name}</span>
                    <span className="block text-[13px] text-muted">{countLabel(t, s.entries.length)}</span>
                  </span>
                </button>
              </div>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {!sets.length ? (
        <span className="text-[11.5px] leading-snug text-dim">{t("newinst.sets_empty")}</span>
      ) : value.length > 0 && mc ? (
        check.isFetching ? (
          <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
            <Spinner size={10} />
            {t("newinst.sets_checking")}
          </span>
        ) : check.data ? (
          <span
            className={cn("flex items-center gap-1.5 text-[11.5px] leading-snug", check.data.available === check.data.total ? "text-ok" : "text-warn")}
            title={check.data.missing.length ? t("newinst.sets_missing", { list: check.data.missing.map((m) => m.title).join(", ") }) : undefined}
          >
            {check.data.available === check.data.total ? <Check size={12} /> : <AlertTriangle size={12} />}
            <span className="truncate">
              {t("newinst.sets_check", { available: check.data.available, total: check.data.total })}
              {check.data.missing.length > 0 && ` · ${t("newinst.sets_missing", { list: check.data.missing.map((m) => m.title).join(", ") })}`}
            </span>
          </span>
        ) : null
      ) : null}
    </div>
  );
}

/** Nach dem Anlegen: Sets installieren (Fehler als Toast). */
export async function installSetsAfterCreate(t: ReturnType<typeof useT>, instanceId: string, setIds: string[]) {
  try {
    const task = await setsApi.installNew(instanceId, setIds);
    const r = await waitForTask(task);
    queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
    queryClient.invalidateQueries({ queryKey: ["mod-sets"] });
    toast.success(t("newinst.sets_done"), r.message ?? undefined);
  } catch (e) {
    if ((e as { kind?: string })?.kind !== "cancelled") toast.error(e, t("newinst.sets_failed"));
  }
}
