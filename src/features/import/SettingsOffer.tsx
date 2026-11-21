// Einstellungen und Daten bereits importierter Instanzen nachträglich übernehmen
// (Backend: content/extsettings.rs, content/gamedata.rs).
// - ImportSettingsHint: einmaliger Hinweis unten links (wie „Neu: Einfacher Modus“), nur wenn es importierte Instanzen
//   gibt, deren Original noch da ist und abweicht (Einstellungen) bzw. in denen Daten fehlen (z. B. `xaero/`, Welten).
//   „Übernehmen“ setzt die vorausgewählten Werte und fügt fehlende Daten hinzu (nie überschreiben), „Ansehen“ öffnet
//   die Liste, „Nicht jetzt“ blendet bis zum nächsten Start aus, „Nie“ für immer. Erledigt/abgelehnt ->
//   `dismissed_notices` (beide IDs, siehe IMPORT_DATA_NOTICE).
// - SettingsReviewDialog: Liste je Instanz mit „alt → neu“ und Abschnitt „Dateien“ (fehlt / in der Quelle neuer),
//   einzeln an-/abwählbar; Überschreiben nur pro Eintrag ausdrücklich (vorher Snapshot bzw. Welt-Backup).
// - ImportSettingsRow: dauerhafter Eintrag in den Instanz-Einstellungen (Allgemein → Herkunft).
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, FileText, Folder, Globe2, History, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Button, Checkbox, Dialog, EmptyState, SettingRow, SettingsCard, Skeleton, Spinner, cn, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useOnboarding } from "@/features/onboarding/store";
import { t as tt, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatBytes, instanceAccent } from "@/lib/format";
import { patchSettings } from "@/lib/mode";
import { qk, queryClient, useInstances, useSettings } from "@/lib/queries";
import type { DataEntry, DataPick, Instance, SettingsChange, SettingsOffer } from "@/lib/types";
import { formatValue, hookLines } from "./settingsFormat";

/** ID in `settings.dismissed_notices`: Hinweis erledigt oder abgelehnt. */
export const IMPORT_SETTINGS_NOTICE = "import-settings-2026-11";
/**
 * Eigene ID für fehlende Daten: Wer den Hinweis mit „Nie“ ausgeblendet hat, hat Einstellungen abgelehnt – fehlende
 * Daten (z. B. `xaero/` nach einem älteren NoRisk-Import, neue Welten) gab es damals nicht im Angebot. Der Hinweis
 * erscheint für diese Nutzer deshalb nur noch, wenn wirklich Daten fehlen, und zeigt dann nur die Daten.
 */
export const IMPORT_DATA_NOTICE = "import-data-2026-11";

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
/** Gewählte Daten je Instanz: Pfad -> überschreiben? */
type Picks = Record<string, boolean>;
/** Vorauswahl Daten: nur Fehlendes hinzufügen, nie überschreiben. */
const dataDefaultsOf = (o: SettingsOffer): Picks => Object.fromEntries(o.data.filter((d) => d.default_on).map((d) => [d.path, false]));
const toPicks = (p: Picks | undefined): DataPick[] => Object.entries(p ?? {}).map(([path, overwrite]) => ({ path, overwrite }));
/** Anzeigename eines Eintrags („Meine Welt“, „xaero/“, „options.txt“). */
export const dataLabel = (d: DataEntry) => (d.kind === "world" ? (d.name ?? d.path.replace(/^saves\//, "")) : d.kind === "dir" ? `${d.path}/` : d.path);

function dismissNotice() {
  const s = queryClient.getQueryData<{ dismissed_notices?: string[] }>(qk.settings);
  const prev = s?.dismissed_notices ?? [];
  const add = [IMPORT_SETTINGS_NOTICE, IMPORT_DATA_NOTICE].filter((n) => !prev.includes(n));
  if (add.length) patchSettings({ dismissed_notices: [...prev, ...add] }).catch(() => {});
}

/** Übernehmen; gibt Anzahl erfolgreicher Instanzen zurück (Fehler als Toast). */
async function applyAll(offers: SettingsOffer[], keys: Record<string, string[]>, data: Record<string, Picks>): Promise<number> {
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

// ------------------------------------------------------------------ Hinweis unten links

export function ImportSettingsHint() {
  const t = useT();
  const s = useSettings().data;
  const onboarding = useOnboarding((x) => x.open);
  const hidden = useReview((x) => x.hintHidden || x.open);
  const [busy, setBusy] = useState(false);
  // Nicht gleichzeitig mit dem Hinweis „Neu: Einfacher Modus“ (gleiche Stelle)
  const simpleHint = !!s && s.onboarding_done && !s.simple_hint_seen && s.ui_mode === "expert";
  const dismissed = s?.dismissed_notices ?? [];
  const withSettings = !dismissed.includes(IMPORT_SETTINGS_NOTICE);
  const withData = !dismissed.includes(IMPORT_DATA_NOTICE);
  const eligible = !!s && s.onboarding_done && !onboarding && !simpleHint && (withSettings || withData);
  const pending = useQuery({ queryKey: pendingKey, queryFn: api.importSettingsPending, enabled: eligible, staleTime: Infinity, retry: 0 });
  // Je Instanz nur, was der Hinweis anbieten darf (Einstellungen bzw. Daten je nach ausgeblendeter ID)
  const offers = (pending.data ?? [])
    .map((o) => ({ ...o, changes: withSettings ? o.changes.filter((c) => c.default_on) : [], data: withData ? o.data.filter((d) => d.default_on) : [] }))
    .filter((o) => o.changes.length || o.data.length);
  if (!eligible || hidden || !offers.length) return null;

  const what = [...new Set(offers.flatMap((o) => o.changes.map((c) => c.key)))]
    .slice(0, 3)
    .map((k) => t(`ext.set.key.${k}`))
    .join(", ");
  const data = [...new Set(offers.flatMap((o) => o.data.map(dataLabel)))].slice(0, 3).join(", ");
  const kind = what && data ? "both" : data ? "data" : "settings";
  const found =
    offers.length === 1
      ? t(kind === "settings" ? "isx.hint.found_1" : `isx.hint.found_${kind}_1`, { name: offers[0].instance_name, what, data })
      : t(kind === "settings" ? "isx.hint.found_n" : `isx.hint.found_${kind}_n`, { n: offers.length, what, data });
  const later = () => useReview.setState({ hintHidden: true });
  const never = () => {
    later();
    dismissNotice();
  };
  const applyNow = async () => {
    setBusy(true);
    const keys = Object.fromEntries(offers.map((o) => [o.instance_id, defaultsOf(o)]));
    const picks = Object.fromEntries(offers.map((o) => [o.instance_id, dataDefaultsOf(o)]));
    const ok = await applyAll(offers, keys, picks);
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

function OfferCard({
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
          <InstanceIcon icon={instance?.icon ?? null} accent={instanceAccent(o.instance_id, instance?.accent ?? null)} size={28} />
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
const DATA_PREVIEW = 8;

function DataSection({ offer: o, picks, onPick, divider }: { offer: SettingsOffer; picks: Picks; onPick: (path: string, overwrite: boolean | null) => void; divider: boolean }) {
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

function DataRow({ entry: d, launcher, pick, onPick }: { entry: DataEntry; launcher: string; pick: boolean | undefined; onPick: (overwrite: boolean | null) => void }) {
  const t = useT();
  const on = pick !== undefined;
  // Nichts fehlt -> Auswählen heißt Überschreiben (ausdrücklich, nie vorausgewählt)
  const onlyOverwrite = d.missing_files === 0;
  const overwrite = on && (onlyOverwrite || pick === true);
  const Icon = d.kind === "world" ? Globe2 : d.kind === "dir" ? Folder : FileText;
  const status =
    d.status === "partial"
      ? d.missing_files === 1
        ? t("isx.data.status.partial_1")
        : t("isx.data.status.partial_n", { n: d.missing_files })
      : d.status === "newer" && d.kind === "world"
        ? t("isx.data.status.newer_world", { launcher })
        : t(`isx.data.status.${d.status}`);
  const size = formatBytes(onlyOverwrite ? d.overwrite_size : d.missing_size || d.size);
  const label = dataLabel(d);
  const folder = d.path.replace(/^saves\//, "");
  const alsoOverwrite = d.overwrite_files === 1 ? t("isx.data.also_overwrite_1") : t("isx.data.also_overwrite", { n: d.overwrite_files });
  return (
    <div className={cn("flex items-start gap-3 rounded-ctl px-1 py-1.5 hover:bg-white/[.03]", overwrite && "bg-warn/[.06]")}>
      <Checkbox checked={on} onChange={(v) => onPick(v ? onlyOverwrite : null)} label={label} className="mt-0.5" />
      <Icon size={15} className="mt-0.5 shrink-0 text-dim" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[13px] text-text" title={d.path}>
            {label}
          </span>
          {d.kind === "world" && d.name && d.name !== folder && <span className="min-w-0 truncate text-[12px] text-dim">{folder}</span>}
          <span
            className={cn(
              "shrink-0 rounded-xs px-1.5 py-px text-caption",
              d.status === "missing" || d.status === "partial" ? "bg-brand/15 text-brand" : d.status === "newer" ? "bg-warn/15 text-warn" : "bg-white/[.06] text-muted",
            )}
          >
            {status}
          </span>
        </div>
        <div className="text-[12px] text-dim">
          {size}
          {!onlyOverwrite && d.kind !== "file" && d.kind !== "world" && ` · ${d.missing_files === 1 ? t("isx.data.files_1") : t("isx.data.files_n", { n: d.missing_files })}`}
        </div>
        {!onlyOverwrite && d.overwrite_files > 0 && d.kind !== "world" && (
          <div className="mt-1">
            <Checkbox
              checked={pick === true}
              onChange={(v) => onPick(v ? true : on ? false : null)}
              label={alsoOverwrite}
              className="inline-flex"
            />
            <span className="ml-2 text-[12px] text-muted">{alsoOverwrite}</span>
          </div>
        )}
        {overwrite && <p className="mt-0.5 text-[12px] leading-snug text-warn">{d.kind === "world" ? t("isx.data.warn_world") : d.overwrite_files === 1 ? t("isx.data.warn_files_1") : t("isx.data.warn_files", { n: d.overwrite_files })}</p>}
        {d.status === "removed" && !on && <p className="mt-0.5 text-[12px] leading-snug text-dim">{t("isx.data.removed_hint")}</p>}
      </div>
    </div>
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

/** „Einstellungen und Daten aus <Launcher> übernehmen“ – nur bei importierten Instanzen, deren Original noch da ist. */
export function ImportSettingsRow({ instance }: { instance: Instance }) {
  const t = useT();
  const q = useQuery({ queryKey: offerKey(instance.id), queryFn: () => api.importSettingsOffer(instance.id), staleTime: 60_000, retry: 0 });
  const o = q.data;
  if (!o) return null;
  const same = !o.changes.length && !o.data.length;
  const missing = o.data.filter((d) => d.missing_files > 0 && d.status !== "removed").length;
  const desc = same
    ? t("isx.row.same")
    : missing
      ? missing === 1
        ? t("isx.row.desc_data_1", { launcher: o.launcher_name })
        : t("isx.row.desc_data_n", { n: missing, launcher: o.launcher_name })
      : t("isx.row.desc");
  return (
    <SettingsCard title={t("isx.row.section")}>
      <SettingRow title={t("isx.row.title", { launcher: o.launcher_name })} description={desc}>
        {!same && (
          <Button size="sm" icon={<History size={13} />} onClick={() => openSettingsReview(instance.id)}>
            {t("isx.row.open")}
          </Button>
        )}
      </SettingRow>
    </SettingsCard>
  );
}
