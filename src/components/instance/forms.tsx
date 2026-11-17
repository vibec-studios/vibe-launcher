// Gemeinsame Formular-Logik für Launcher- und Instanz-Einstellungen: Auto-Speichern mit Entwurf,
// Arbeitsspeicher-Regler, Java-Auswahl.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, FolderSearch, Loader2, TestTube2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { JavaInstall } from "@/lib/types";
import { Button, Input, NumberInput, Select, Slider, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Lokaler Entwurf, der Änderungen gebündelt und verzögert speichert. Neue Server-Daten (per Event)
 * übernimmt er nur, solange nichts aussteht – so springt beim Tippen nichts zurück.
 */
export function useAutoSave<T, P extends object>(server: T, apply: (base: T, patch: P) => T, save: (patch: P) => Promise<unknown>) {
  const [draft, setDraft] = useState(server);
  const [state, setState] = useState<SaveState>("idle");
  const pending = useRef<P | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  const serverRef = useRef(server);
  serverRef.current = server;

  useEffect(() => {
    if (!pending.current) setDraft(server);
  }, [server]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    setState("saving");
    try {
      await saveRef.current(p);
      setState("saved");
    } catch (e) {
      toast.error(e);
      setState("error");
      if (!pending.current) setDraft(serverRef.current);
    }
  }, []);

  const update = useCallback(
    (p: P, delay = 0) => {
      pending.current = { ...(pending.current ?? {}), ...p } as P;
      setDraft((d) => apply(d, p));
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flush],
  );

  /** Nur den Entwurf ändern (z. B. ungültige Zwischenstände beim Tippen), ohne zu speichern. */
  const local = useCallback((p: P) => setDraft((d) => apply(d, p)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useCallback(() => {
    if (!pending.current) setDraft(serverRef.current);
  }, []);

  // Beim Verlassen nichts verlieren
  useEffect(() => () => void flush(), [flush]);

  // „Gespeichert“ nach kurzer Zeit ausblenden
  useEffect(() => {
    if (state !== "saved") return;
    const id = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(id);
  }, [state]);

  return { draft, update, local, reset, state, flush };
}

export function SaveIndicator({ state }: { state: SaveState }) {
  const t = useT();
  if (state === "idle" || state === "error") return null;
  return (
    <span className={cn("flex items-center gap-1.5 text-[12px] font-medium animate-fade-in", state === "saved" ? "text-ok" : "text-dim")}>
      {state === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      {state === "saving" ? t("form.saving") : t("form.saved")}
    </span>
  );
}

export const formatMb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB` : `${mb} MB`);

/** Min/Max-Arbeitsspeicher mit Reglern und Zahleneingabe. */
export function MemoryField({
  min,
  max,
  total,
  onChange,
  disabled,
}: {
  min: number;
  max: number;
  total: number;
  onChange: (v: { min: number; max: number }, delay?: number) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const limit = Math.max(1024, Math.floor(total / 256) * 256);
  const warn = max > total * 0.75;
  const row = (label: string, value: number, lo: number, set: (v: number, delay?: number) => void) => (
    <div className="grid grid-cols-[64px_minmax(0,1fr)_120px] items-center gap-4">
      <span className="label">{label}</span>
      <div className="flex flex-col gap-1">
        <Slider value={value} min={lo} max={limit} step={256} onChange={(v) => set(v, 400)} disabled={disabled} />
        <div className="flex justify-between text-[11px] tabular-nums text-dim">
          <span>{formatMb(lo)}</span>
          <span className="text-muted">{formatMb(value)}</span>
          <span>{formatMb(limit)}</span>
        </div>
      </div>
      <NumberInput value={value} onChange={(v) => v !== null && set(v)} min={lo} max={limit} step={1} unit="MB" disabled={disabled} aria-label={label} />
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      {row(t("form.ram.max"), max, 512, (v, d) => onChange({ min: Math.min(min, v), max: v }, d))}
      {row(t("form.ram.min"), min, 256, (v, d) => onChange({ min: Math.min(v, max), max: Math.max(max, v) }, d))}
      {warn && <p className="text-[12px] text-warn">{t("form.ram.warn", { total: formatMb(total) })}</p>}
    </div>
  );
}

export function useJavaList() {
  return useQuery({ queryKey: qk.java, queryFn: api.javaList, staleTime: 5 * 60_000 });
}

export async function pickJava(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, directory: false, filters: [{ name: "Java", extensions: ["exe", ""] }] });
    return typeof r === "string" ? r : null;
  } catch (e) {
    toast.error(e);
    return null;
  }
}

/** Java-Pfad wählen: aus gefundenen Installationen, per Datei-Dialog oder von Hand, mit Test. */
export function JavaPathField({
  value,
  onChange,
  filterMajor,
  autoLabel,
}: {
  value: string | null;
  onChange: (path: string | null, delay?: number) => void;
  filterMajor?: number;
  autoLabel?: string;
}) {
  const t = useT();
  const java = useJavaList();
  const [result, setResult] = useState<{ ok: true; info: JavaInstall } | { ok: false; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState(value ?? "");
  useEffect(() => {
    setResult(null);
    setText((cur) => (cur.trim() === (value ?? "") ? cur : (value ?? "")));
  }, [value]);

  const list = (java.data ?? []).filter((j) => filterMajor === undefined || j.major === filterMajor);
  const known = list.some((j) => j.path === value);
  const sel = value === null ? (custom ? "custom" : "auto") : known ? value : "custom";
  const options = [
    { value: "auto", label: autoLabel ?? t("form.java.auto") },
    ...list.map((j) => ({ value: j.path, label: `Java ${j.version}${j.vendor ? ` · ${j.vendor}` : ""}`, hint: j.managed ? t("form.java.managed") : j.arch })),
    { value: "custom", label: t("form.java.custom") },
  ];

  const test = async () => {
    const path = text.trim();
    if (!path) return;
    setTesting(true);
    try {
      setResult({ ok: true, info: await api.javaTest(path) });
    } catch (e) {
      setResult({ ok: false, msg: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={sel}
        onChange={(v) => {
          setCustom(v === "custom");
          if (v === "auto") onChange(null);
          else if (v !== "custom") onChange(v);
        }}
        options={options}
      />
      {sel !== "auto" && (
        <div className="flex gap-2">
          <Input
            className="flex-1 font-mono text-[12px]"
            value={text}
            placeholder={"C:\\Program Files\\Java\\bin\\javaw.exe"}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim()) onChange(e.target.value.trim(), 600);
            }}
          />
          <Tooltip content={t("common.browse")}>
            <Button
              icon={<FolderSearch size={14} />}
              onClick={async () => {
                const p = await pickJava();
                if (p) {
                  setText(p);
                  onChange(p);
                }
              }}
            />
          </Tooltip>
          <Button icon={<TestTube2 size={14} />} loading={testing} disabled={!text.trim()} onClick={test}>
            {t("form.java.test")}
          </Button>
        </div>
      )}
      {result && (
        <p className={cn("selectable text-[12px]", result.ok ? "text-ok" : "text-danger")}>
          {result.ok ? t("form.java.ok", { version: result.info.version, vendor: result.info.vendor ?? "", arch: result.info.arch }) : result.msg}
        </p>
      )}
    </div>
  );
}
