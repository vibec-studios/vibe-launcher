// Skins aus anderen Launchern (Modrinth App, NoRisk Client, Lunar Client) übernehmen: Knopf mit Anzahl neuer Skins,
// Dialog mit Vorschau-Auswahl je Quelle, Schalter „Automatisch importieren“. Fremde Dateien werden nur gelesen.
import { memo, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Check, Download } from "lucide-react";
import type { SkinVariant } from "@/lib/types";
import { queryClient } from "@/lib/queries";
import { Button, Checkbox, Dialog, ErrorState, SettingRow, SettingsCard, Skeleton, Switch, Tag, Tooltip, cn, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { useSkinFront } from "./render";

export type ImportSource = "modrinth" | "norisk" | "lunar";

export interface FoundSkin {
  key: string;
  source: ImportSource;
  name: string;
  variant: SkinVariant;
  cape_id: string | null;
  sha1: string;
  data_url: string;
  in_library: boolean;
}

export interface SourceScan {
  source: ImportSource;
  label: string;
  path: string;
  skins: FoundSkin[];
  error: string | null;
}

export interface ImportScan {
  sources: SourceScan[];
  new_count: number;
  auto_import: boolean;
}

const importApi = {
  scan: () => invoke<ImportScan>("skin_import_scan"),
  run: (keys: string[] | null) => invoke<{ imported: number; skipped: number }>("skin_import_run", { keys }),
  setAuto: (enabled: boolean) => invoke<void>("skin_import_set_auto", { enabled }),
};

export const importKey = ["skin-import-scan"] as const;

export function useSkinImportScan(enabled = true) {
  return useQuery({
    queryKey: importKey,
    queryFn: importApi.scan,
    staleTime: 60_000,
    enabled,
    retry: false,
  });
}

export const sourceLabels: Record<ImportSource, string> = {
  modrinth: "Modrinth App",
  norisk: "NoRisk Client",
  lunar: "Lunar Client",
};

const ImportTile = memo(function ImportTile({ skin, checked, onToggle }: { skin: FoundSkin; checked: boolean; onToggle: (v: boolean) => void }) {
  const t = useT();
  const img = useSkinFront(skin.data_url, skin.variant, 3);
  const disabled = skin.in_library;
  return (
    <label
      className={cn(
        "relative flex cursor-pointer flex-col items-center gap-1.5 rounded-card bg-surface p-2 pt-2.5 transition-colors duration-100 hover:bg-surface3",
        checked && "shadow-[inset_0_0_0_1.5px_var(--accent)]",
        disabled && "cursor-default opacity-50 hover:bg-surface",
      )}
    >
      <span className="absolute left-1.5 top-1.5">
        {disabled ? <Check size={14} className="text-ok" /> : <Checkbox checked={checked} onChange={onToggle} label={skin.name} />}
      </span>
      <div className="flex h-[96px] w-full items-center justify-center overflow-hidden">
        {img ? <img src={img} alt="" className="h-[96px] w-auto object-contain [image-rendering:pixelated]" /> : <Skeleton className="h-[80px] w-[40px]" />}
      </div>
      <div className="w-full truncate text-center text-[12px] font-semibold text-text" title={skin.name}>
        {skin.name}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-caption text-dim">{skin.variant === "slim" ? t("skins.slim") : t("skins.classic")}</span>
        {skin.cape_id && (
          <Tooltip content={t("skins.import.cape_hint")}>
            <span>
              <Tag color="var(--accent)">{t("skins.import.cape")}</Tag>
            </span>
          </Tooltip>
        )}
      </div>
      {disabled && <span className="text-caption text-ok">{t("skins.import.in_library")}</span>}
    </label>
  );
});

export function SkinImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const scan = useSkinImportScan(open);
  const all = useMemo(() => scan.data?.sources.flatMap((s) => s.skins) ?? [], [scan.data]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Vorauswahl: alle neuen (gleiches Bild aus mehreren Quellen nur einmal)
  useEffect(() => {
    if (!open || !scan.data) return;
    const seen = new Set<string>();
    setSel(new Set(all.filter((s) => !s.in_library && !seen.has(s.sha1) && seen.add(s.sha1)).map((s) => s.key)));
  }, [open, scan.data, all]);

  const toggle = (k: string, on: boolean) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });

  const run = async () => {
    setBusy(true);
    try {
      const r = await importApi.run([...sel]);
      toast.success(tt("skins.import.done", { n: r.imported }), r.skipped ? tt("skins.import.skipped", { n: r.skipped }) : undefined);
      queryClient.invalidateQueries({ queryKey: ["skin-library"] });
      queryClient.invalidateQueries({ queryKey: importKey });
      onOpenChange(false);
    } catch (e) {
      toast.error(e, tt("skins.import.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("skins.import.title")}
      description={t("skins.import.desc")}
      size="lg"
      locked={busy}
      footer={
        <>
          {scan.data && <AutoImportSwitch value={scan.data.auto_import} />}
          <div className="flex-1" />
          <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<Download size={14} />} onClick={run} disabled={sel.size === 0} loading={busy}>
            {t("skins.import.run", { n: sel.size })}
          </Button>
        </>
      }
    >
      {scan.isError ? (
        <ErrorState error={scan.error} onRetry={() => scan.refetch()} className="py-8" />
      ) : !scan.data ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[150px]" />
          ))}
        </div>
      ) : scan.data.sources.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-dim">{t("skins.import.none_installed")}</p>
      ) : (
        <div className="flex max-h-[56vh] flex-col gap-5 overflow-y-auto pr-1">
          {scan.data.sources.map((src) => {
            const fresh = src.skins.filter((s) => !s.in_library);
            const allOn = fresh.length > 0 && fresh.every((s) => sel.has(s.key));
            return (
              <section key={src.source} className="flex flex-col gap-2">
                <header className="flex items-center gap-3">
                  <h3 className="text-[13px] font-semibold text-text">{src.label}</h3>
                  <span className="text-caption text-dim">
                    {t("skins.import.found", {
                      n: src.skins.length,
                      fresh: fresh.length,
                    })}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-dim" title={src.path}>
                    {src.path}
                  </span>
                  {fresh.length > 0 && (
                    <button
                      type="button"
                      className="shrink-0 text-[12px] text-muted hover:text-text"
                      onClick={() => fresh.forEach((s) => toggle(s.key, !allOn))}
                    >
                      {allOn ? t("common.none") : t("common.all")}
                    </button>
                  )}
                </header>
                {src.error && <p className="text-[12px] text-warn">{src.error}</p>}
                {src.skins.length === 0 ? (
                  <p className="text-[12px] text-dim">{t("skins.import.source_empty")}</p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
                    {src.skins.map((s) => (
                      <ImportTile key={s.key} skin={s} checked={sel.has(s.key)} onToggle={(v) => toggle(s.key, v)} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}

function AutoImportSwitch({ value, bare }: { value: boolean; bare?: boolean }) {
  const t = useT();
  const [on, setOn] = useState(value);
  useEffect(() => setOn(value), [value]);
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
      <Switch
        checked={on}
        onChange={async (v) => {
          setOn(v);
          try {
            await importApi.setAuto(v);
            queryClient.setQueryData<ImportScan>(importKey, (d) => d && { ...d, auto_import: v });
          } catch (e) {
            setOn(!v);
            toast.error(e);
          }
        }}
        label={t("skins.import.auto")}
      />
      {!bare && t("skins.import.auto")}
    </label>
  );
}

/** Knopf in der Bibliothek: nur sichtbar, wenn ein anderer Launcher installiert ist und neue Skins hat. */
export function SkinImportButton() {
  const t = useT();
  const scan = useSkinImportScan();
  const [open, setOpen] = useState(false);
  const n = scan.data?.new_count ?? 0;
  if (!scan.data || n === 0) return <SkinImportDialog open={open} onOpenChange={setOpen} />;
  const names = scan.data.sources.filter((s) => s.skins.some((k) => !k.in_library)).map((s) => s.label);
  return (
    <>
      <Tooltip content={t("skins.import.button_hint", { apps: names.join(", ") })}>
        <Button size="sm" variant="subtle" icon={<Download size={14} />} onClick={() => setOpen(true)}>
          {t("skins.import.button", { n })}
        </Button>
      </Tooltip>
      <SkinImportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Abschnitt in den Einstellungen; erscheint nur, wenn mindestens einer der Launcher installiert ist. */
export function SkinImportSettings() {
  const t = useT();
  const scan = useSkinImportScan();
  const [open, setOpen] = useState(false);
  if (!scan.data || scan.data.sources.length === 0) return null;
  const apps = scan.data.sources.map((s) => `${s.label} (${s.skins.length})`).join(", ");
  return (
    <SettingsCard title={t("skins.import.settings_title")}>
      <SettingRow title={t("skins.import.found_apps")} description={apps}>
        <Button icon={<Download size={14} />} onClick={() => setOpen(true)}>
          {scan.data.new_count > 0 ? t("skins.import.button", { n: scan.data.new_count }) : t("skins.import.open")}
        </Button>
      </SettingRow>
      <SettingRow title={t("skins.import.auto")} description={t("skins.import.auto_desc")}>
        <AutoImportSwitch value={scan.data.auto_import} bare />
      </SettingRow>
      <SkinImportDialog open={open} onOpenChange={setOpen} />
    </SettingsCard>
  );
}
