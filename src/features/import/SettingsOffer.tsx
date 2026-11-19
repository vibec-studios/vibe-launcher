// Einstellungen bereits importierter Instanzen nachträglich übernehmen (Backend: content/extsettings.rs).
// - ImportSettingsHint: einmaliger Hinweis unten links (wie „Neu: Einfacher Modus“), nur wenn es importierte Instanzen
//   gibt, deren Original noch da ist und abweicht. „Übernehmen“ setzt die vorausgewählten Werte, „Ansehen“ öffnet die
//   Liste, „Nicht jetzt“ blendet bis zum nächsten Start aus, „Nie“ für immer. Erledigt/abgelehnt -> `dismissed_notices`.
// - SettingsReviewDialog: Liste je Instanz mit „alt → neu“, einzeln an-/abwählbar; für eine Instanz (aus den
//   Instanz-Einstellungen) zusätzlich „Dateien erneut übernehmen“ (options.txt, config/ – nur auf Wunsch, mit Snapshot).
// - ImportSettingsRow: dauerhafter Eintrag in den Instanz-Einstellungen.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, FileCog, History, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Button, Checkbox, Dialog, EmptyState, SettingRow, SettingsCard, Skeleton, Spinner, cn, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useOnboarding } from "@/features/onboarding/store";
import { t as tt, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { instanceAccent } from "@/lib/format";
import { patchSettings } from "@/lib/mode";
import { qk, queryClient, useInstances, useSettings } from "@/lib/queries";
import type { Instance, SettingsChange, SettingsOffer } from "@/lib/types";
import { formatValue, hookLines } from "./settingsFormat";

/** ID in `settings.dismissed_notices`: Hinweis erledigt oder abgelehnt. */
export const IMPORT_SETTINGS_NOTICE = "import-settings-2026-11";

const pendingKey = ["import-settings", "pending"] as const;
const offerKey = (id: string) => ["import-settings", "offer", id] as const;
/** Liste für eine Instanz (eigene Form: Array) – nicht mit `offerKey` (einzelnes Angebot) teilen. */
const reviewKey = (id: string) => ["import-settings", "review", id] as const;

interface ReviewState {
  open: boolean;
  /** null = alle importierten Instanzen (aus dem Hinweis) */
  instanceId: string | null;
  /** Hinweis in dieser Sitzung ausgeblendet („Nicht jetzt“ oder Liste geöffnet) */
  hintHidden: boolean;
}
const useReview = create<ReviewState>(() => ({ open: false, instanceId: null, hintHidden: false }));

export function openSettingsReview(instanceId: string | null = null) {
  useReview.setState({ open: true, instanceId, hintHidden: true });
}

/** Ausgewählte Bereiche je Instanz (Standard: wie vom Backend vorgeschlagen). */
const defaultsOf = (o: SettingsOffer) => o.changes.filter((c) => c.default_on).map((c) => c.key as string);

function dismissNotice() {
  const s = queryClient.getQueryData<{ dismissed_notices?: string[] }>(qk.settings);
  const prev = s?.dismissed_notices ?? [];
  if (!prev.includes(IMPORT_SETTINGS_NOTICE)) patchSettings({ dismissed_notices: [...prev, IMPORT_SETTINGS_NOTICE] }).catch(() => {});
}

/** Übernehmen; gibt Anzahl erfolgreicher Instanzen zurück (Fehler als Toast). */
async function applyAll(offers: SettingsOffer[], keys: Record<string, string[]>, files: Record<string, string[]>): Promise<number> {
  let ok = 0;
  const errors: string[] = [];
  for (const o of offers) {
    const k = keys[o.instance_id] ?? [];
    const f = files[o.instance_id] ?? [];
    if (!k.length && !f.length) continue;
    try {
      await api.importSettingsApply(o.instance_id, k, f);
      ok++;
    } catch (e) {
      errors.push(`${o.instance_name}: ${errorMessage(e)}`);
    }
  }
  queryClient.invalidateQueries({ queryKey: qk.instances });
  queryClient.invalidateQueries({ queryKey: ["import-settings"] });
  if (errors.length) toast.error(tt("isx.failed"), errors.join("\n"));
  else if (ok) {
    const one = offers.find((o) => (keys[o.instance_id]?.length ?? 0) + (files[o.instance_id]?.length ?? 0) > 0);
    toast.success(tt("isx.done"), ok === 1 && one ? tt("isx.done_1", { name: one.instance_name }) : tt("isx.done_n", { n: ok }));
  }
  return ok;
}

// ------------------------------------------------------------------ Hinweis unten links

export function ImportSettingsHint() {
  const t = useT();
  const s = useSettings().data;
  const onboarding = useOnboarding((x) => x.open);
  const hidden = useReview((x) => x.hintHidden || x.open);
  const [busy, setBusy] = useState(false);
  // Nicht gleichzeitig mit dem Hinweis „Neu: Einfacher Modus“ (gleiche Stelle)
  const simpleHint = !!s && s.onboarding_done && !s.simple_hint_seen && s.ui_mode === "expert";
  const eligible = !!s && s.onboarding_done && !onboarding && !simpleHint && !(s.dismissed_notices ?? []).includes(IMPORT_SETTINGS_NOTICE);
  const pending = useQuery({ queryKey: pendingKey, queryFn: api.importSettingsPending, enabled: eligible, staleTime: Infinity, retry: 0 });
  const offers = (pending.data ?? []).filter((o) => o.changes.some((c) => c.default_on));
  if (!eligible || hidden || !offers.length) return null;

  const what = [...new Set(offers.flatMap((o) => o.changes.filter((c) => c.default_on).map((c) => c.key)))]
    .slice(0, 3)
    .map((k) => t(`ext.set.key.${k}`))
    .join(", ");
  const found = offers.length === 1 ? t("isx.hint.found_1", { name: offers[0].instance_name, what }) : t("isx.hint.found_n", { n: offers.length, what });
  const later = () => useReview.setState({ hintHidden: true });
  const never = () => {
    later();
    dismissNotice();
  };
  const applyNow = async () => {
    setBusy(true);
    const keys = Object.fromEntries(offers.map((o) => [o.instance_id, defaultsOf(o)]));
    const ok = await applyAll(offers, keys, {});
    setBusy(false);
    if (ok) never();
  };

  return (
    <div
      role="status"
      className="vl-bubble fixed bottom-4 z-[45] flex w-[380px] flex-col gap-3 rounded-card bg-overlay p-4 shadow-e3"
      style={{ left: "calc(var(--rail-w) + 16px)" }}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-card bg-brand/15 text-brand">
          <History size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-text">{t("isx.hint.title")}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{t("isx.hint.text")}</p>
          <p className="mt-1 text-[12px] leading-snug text-dim">{found}</p>
        </div>
        <button aria-label={t("isx.hint.later")} title={t("isx.hint.later")} onClick={later} className="-mr-1.5 -mt-1 grid h-7 w-7 place-items-center rounded-ctl text-dim hover:bg-white/[.07] hover:text-text">
          <X size={15} />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="subtle" className="px-2" onClick={later} disabled={busy}>
          {t("isx.hint.later")}
        </Button>
        <Button size="sm" variant="subtle" className="px-2" onClick={never} disabled={busy}>
          {t("isx.hint.never")}
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={() => openSettingsReview(null)} disabled={busy}>
          {t("isx.hint.view")}
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void applyNow()}>
          {t("isx.hint.apply")}
        </Button>
      </div>
    </div>
  );
}

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
  const offers = useMemo(() => (q.data ?? []).filter((o) => o.changes.length || o.files.length), [q.data]);
  const [keys, setKeys] = useState<Record<string, string[]>>({});
  const [files, setFiles] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const { data: instances = [] } = useInstances();

  // Neue Daten -> Vorauswahl
  useEffect(() => {
    if (!q.data) return;
    setKeys(Object.fromEntries(q.data.map((o) => [o.instance_id, defaultsOf(o)])));
    setFiles({});
  }, [q.data]);

  const close = () => useReview.setState({ open: false });
  const count = Object.values(keys).reduce((n, k) => n + k.length, 0) + Object.values(files).reduce((n, f) => n + f.length, 0);
  const toggle = (set: typeof setKeys, id: string, k: string, on: boolean) =>
    set((s) => ({ ...s, [id]: on ? [...new Set([...(s[id] ?? []), k])] : (s[id] ?? []).filter((x) => x !== k) }));
  const apply = async () => {
    setBusy(true);
    const ok = await applyAll(offers, keys, files);
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
    body = <EmptyState icon={<AlertTriangle size={28} />} title={t("isx.failed")} text={errorMessage(q.error)} className="py-10" />;
  } else if (!offers.length) {
    body = <EmptyState icon={<History size={28} />} title={t("isx.empty_title")} text={t("isx.empty_text")} className="py-10" />;
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
            files={files[o.instance_id] ?? []}
            onKey={(k, on) => toggle(setKeys, o.instance_id, k, on)}
            onFile={(k, on) => toggle(setFiles, o.instance_id, k, on)}
            onAll={(on) => setKeys((s) => ({ ...s, [o.instance_id]: on ? o.changes.map((c) => c.key) : [] }))}
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

function OfferCard({
  offer: o,
  instance,
  single,
  keys,
  files,
  onKey,
  onFile,
  onAll,
}: {
  offer: SettingsOffer;
  instance: Instance | undefined;
  single: boolean;
  keys: string[];
  files: string[];
  onKey: (k: string, on: boolean) => void;
  onFile: (k: string, on: boolean) => void;
  onAll: (on: boolean) => void;
}) {
  const t = useT();
  const all = o.changes.length > 0 && o.changes.every((c) => keys.includes(c.key));
  return (
    <section className="flex flex-col rounded-card bg-white/[.03]">
      {!single && (
        <header className="flex items-center gap-3 px-3 pb-1 pt-3">
          <Checkbox checked={all} onChange={onAll} label={o.instance_name} />
          <InstanceIcon icon={instance?.icon ?? null} accent={instanceAccent(o.instance_id, instance?.accent ?? null)} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-text">{o.instance_name}</div>
            <div className="truncate text-[12px] text-dim">{t("isx.from", { launcher: o.launcher_name })}</div>
          </div>
        </header>
      )}
      <div className="flex flex-col py-1.5">
        {o.changes.map((c) => (
          <ChangeRow key={c.key} change={c} launcher={o.launcher_name} on={keys.includes(c.key)} onChange={(on) => onKey(c.key, on)} />
        ))}
      </div>
      {o.notes.map((n) => (
        <p key={n} className="flex items-start gap-1.5 px-3 pb-2 text-[12px] text-dim">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {n}
        </p>
      ))}
      {single && o.files.length > 0 && (
        <div className="mx-3 mb-3 mt-1 flex flex-col gap-1 border-t border-line pt-3">
          <div className="text-[12.5px] font-semibold text-text">{t("isx.files.title")}</div>
          <p className="pb-1 text-[12px] leading-snug text-dim">{t("isx.files.desc", { launcher: o.launcher_name })}</p>
          {o.files.map((f) => (
            <label key={f.key} className="flex cursor-default items-start gap-3 rounded-ctl px-1 py-1.5 hover:bg-white/[.03]">
              <Checkbox checked={files.includes(f.key)} onChange={(on) => onFile(f.key, on)} label={t(`isx.files.${f.key}`)} className="mt-0.5" />
              <FileCog size={15} className="mt-0.5 shrink-0 text-dim" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-text">{t(`isx.files.${f.key}`)}</div>
                <div className="truncate text-[12px] text-dim">
                  {f.items.join(", ")} · {f.changed === 1 ? t("isx.files.changed_1") : t("isx.files.changed_n", { n: f.changed })}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

function ChangeRow({ change: c, launcher, on, onChange }: { change: SettingsChange; launcher: string; on: boolean; onChange: (on: boolean) => void }) {
  const t = useT();
  const hooks = c.key === "hooks" ? hookLines((c.new ?? {}) as never) : [];
  const keepHint = !c.default_on && c.key !== "hooks";
  return (
    <div className={cn("flex items-start gap-3 px-3 py-1.5", c.key === "hooks" && on && "bg-warn/[.06]")}>
      <Checkbox checked={on} onChange={onChange} label={t(`ext.set.key.${c.key}`)} className="mt-0.5" />
      <div className="w-[150px] shrink-0 pt-px text-[13px] text-muted">{t(`ext.set.key.${c.key}`)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 pt-px text-[13px]">
          <span className="min-w-0 truncate text-dim line-through decoration-white/20">{formatValue(c.key, c.old)}</span>
          <ArrowRight size={12} className="shrink-0 text-dim" />
          {c.key === "icon" && typeof c.new === "string" ? (
            <img src={c.new} alt="" className="h-5 w-5 rounded-xs object-cover" />
          ) : c.key === "hooks" ? null : (
            <span className="min-w-0 truncate font-medium text-text" title={formatValue(c.key, c.new)}>
              {formatValue(c.key, c.new)}
            </span>
          )}
          {c.inherited && <span className="shrink-0 rounded-xs bg-white/[.06] px-1.5 py-px text-caption text-muted">{t("ext.set.inherited", { launcher })}</span>}
        </div>
        {hooks.map((h) => (
          <div key={h.label} className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-warn">
            <Terminal size={12} className="shrink-0" />
            <span className="shrink-0">{h.label}:</span>
            <code className="selectable min-w-0 break-all font-mono text-[11.5px]">{h.cmd}</code>
          </div>
        ))}
        {c.key === "hooks" && <p className="mt-0.5 text-[12px] leading-snug text-warn">{t("isx.hooks_warn")}</p>}
        {keepHint && <p className="mt-0.5 text-[12px] leading-snug text-dim">{t("isx.keep_hint")}</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Instanz-Einstellungen

/** „Einstellungen aus <Launcher> übernehmen“ – nur bei importierten Instanzen, deren Original noch da ist. */
export function ImportSettingsRow({ instance }: { instance: Instance }) {
  const t = useT();
  const q = useQuery({ queryKey: offerKey(instance.id), queryFn: () => api.importSettingsOffer(instance.id), staleTime: 60_000, retry: 0 });
  const o = q.data;
  if (!o) return null;
  const same = !o.changes.length && !o.files.length;
  return (
    <SettingsCard title={t("isx.row.section")}>
      <SettingRow title={t("isx.row.title", { launcher: o.launcher_name })} description={same ? t("isx.row.same") : t("isx.row.desc")}>
        {!same && (
          <Button size="sm" icon={<History size={13} />} onClick={() => openSettingsReview(instance.id)}>
            {t("isx.row.open")}
          </Button>
        )}
      </SettingRow>
    </SettingsCard>
  );
}
