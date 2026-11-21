// Clip-Editor (Vertrag 14): Bereich wählen, Anfang rastet auf den letzten Keyframe davor ein (Schnitt ohne Neukodierung),
// Schnitt merken (`trim`) oder als neuen Clip speichern (reason "edit").
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Pause, Play, RotateCcw, Scissors, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Clip, ClipExport, TrimRange } from "@/lib/types";
import { Button, Checkbox, Tooltip, cn, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatClipLength } from "./clips";

const MIN_MS = 1000;

export function snapStart(keyframes: number[], ms: number) {
  if (!keyframes.length) return Math.max(0, Math.round(ms));
  let best = 0;
  for (const k of keyframes) if (k <= ms) best = k;
  return best;
}

function initialRange(clip: Clip, total: number): TrimRange {
  const r = clip.trim ?? clip.trim_hint;
  if (r && r.in_ms >= 0 && r.out_ms > r.in_ms && r.out_ms <= total + 50) return { in_ms: r.in_ms, out_ms: Math.min(r.out_ms, total) };
  return { in_ms: 0, out_ms: total };
}

function fmt(ms: number) {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

export function ClipEditor({
  clip,
  video,
  pos,
  total,
  onChanged,
  onExported,
}: {
  clip: Clip;
  video: RefObject<HTMLVideoElement | null>;
  pos: number;
  total: number;
  onChanged: (c: Clip) => void;
  onExported: (r: ClipExport) => void;
}) {
  const t = useT();
  const totalMs = Math.max(1, Math.round(total * 1000));
  const [range, setRange] = useState<TrimRange>(() => initialRange(clip, totalMs));
  const [busy, setBusy] = useState<"save" | "export" | null>(null);
  const [deleteOriginal, setDeleteOriginal] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<"in" | "out" | null>(null);
  const ffmpeg = useQuery({ queryKey: ["clips", "ffmpeg", clip.instance_id], queryFn: () => api.clipExportAvailable(clip.instance_id, clip.id), staleTime: 60_000 });

  useEffect(() => setRange((r) => (r.out_ms > totalMs + 50 || r.out_ms === 0 ? initialRange(clip, totalMs) : r)), [totalMs, clip]);

  useEffect(() => {
    if (previewing && pos * 1000 >= range.out_ms) {
      video.current?.pause();
      setPreviewing(false);
    }
  }, [pos, previewing, range.out_ms, video]);

  const keyframes = clip.keyframes_ms;
  const start = snapStart(keyframes, range.in_ms);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / totalMs) * 100))}%`;
  const ticks = useMemo(() => (keyframes.length <= 400 ? keyframes : []), [keyframes]);
  const hint = clip.trim_hint;
  const dirty = !clip.trim || clip.trim.in_ms !== range.in_ms || clip.trim.out_ms !== range.out_ms;
  const whole = start === 0 && range.out_ms >= totalMs - 50;

  const msAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * totalMs);
  };

  const setIn = (ms: number) => setRange((r) => ({ in_ms: Math.max(0, Math.min(ms, r.out_ms - MIN_MS)), out_ms: r.out_ms }));
  const setOut = (ms: number) => setRange((r) => ({ in_ms: r.in_ms, out_ms: Math.min(totalMs, Math.max(ms, snapStart(keyframes, r.in_ms) + MIN_MS)) }));

  const onDown = (which: "in" | "out") => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = which;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const ms = msAt(e.clientX);
    if (drag.current === "in") setIn(ms);
    else setOut(ms);
  };
  const onUp = () => {
    drag.current = null;
  };

  const seek = (ms: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = ms / 1000;
  };

  const preview = () => {
    const v = video.current;
    if (!v) return;
    if (previewing) {
      v.pause();
      setPreviewing(false);
      return;
    }
    v.currentTime = start / 1000;
    v.play().catch(() => {});
    setPreviewing(true);
  };

  const save = async () => {
    setBusy("save");
    try {
      const c = await api.clipSetTrim(clip.instance_id, clip.id, whole ? null : { in_ms: range.in_ms, out_ms: range.out_ms });
      onChanged(c);
      toast.success(t("clipedit.saved"));
    } catch (e) {
      toast.error(e, t("clips.save_failed"));
    } finally {
      setBusy(null);
    }
  };

  const exportClip = async () => {
    if (deleteOriginal) {
      const ok = await confirm({ title: t("clipedit.delete_original.title"), text: t("clipedit.delete_original.text"), confirmLabel: t("clipedit.export"), danger: true });
      if (!ok) return;
    }
    setBusy("export");
    try {
      const r = await api.clipExportTrim(clip.instance_id, clip.id, range.in_ms, range.out_ms, deleteOriginal);
      toast.success(t("clipedit.exported"), t("clipedit.exported_text", { len: formatClipLength(r.clip.duration_ms) }));
      onExported(r);
    } catch (e) {
      toast.error(e, t("clipedit.export_failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-card bg-surface px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Scissors size={16} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-text">{t("clipedit.title")}</div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("clipedit.text")}</p>
        </div>
      </div>

      <div
        ref={bar}
        className="relative h-10 touch-none select-none rounded-ctl bg-field"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={(e) => seek(msAt(e.clientX))}
        role="group"
        aria-label={t("clipedit.timeline")}
      >
        {ticks.map((k) => (
          <span key={k} className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-white/15" style={{ left: pct(k) }} />
        ))}
        <div className="pointer-events-none absolute inset-y-0 rounded-ctl bg-accent/25 ring-1 ring-inset ring-accent/70" style={{ left: pct(start), width: `calc(${pct(range.out_ms)} - ${pct(start)})` }} />
        {start !== range.in_ms && (
          <span className="pointer-events-none absolute inset-y-1 w-px bg-accent/50" style={{ left: pct(range.in_ms) }} title={t("clipedit.wish_start")} />
        )}
        {hint && (
          <span className="pointer-events-none absolute -top-1 h-1 rounded-pill bg-warn/70" style={{ left: pct(hint.in_ms), width: `calc(${pct(hint.out_ms)} - ${pct(hint.in_ms)})` }} />
        )}
        {clip.cuts_ms.map((c) => (
          <Tooltip key={c} content={`${t("clipedit.cut")} · ${formatClipLength(c)}`}>
            <span className="absolute inset-y-0 w-0 border-l border-dashed border-white/50" style={{ left: pct(c) }} />
          </Tooltip>
        ))}
        <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-text/80" style={{ left: pct(pos * 1000) }} />
        {(["in", "out"] as const).map((w) => (
          <button
            key={w}
            type="button"
            aria-label={w === "in" ? t("clipedit.start") : t("clipedit.end")}
            onPointerDown={onDown(w)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 5000 : 1000;
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const d = e.key === "ArrowLeft" ? -step : step;
              if (w === "in") setIn((keyframes.length ? start : range.in_ms) + d);
              else setOut(range.out_ms + d);
            }}
            className="absolute top-1/2 grid h-8 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-xs bg-accent shadow-e1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{ left: pct(w === "in" ? start : range.out_ms) }}
          >
            <span className="h-3.5 w-px bg-[var(--on-accent)]/70" />
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] tabular-nums text-muted">
        <span>
          {t("clipedit.start")}: <span className="font-semibold text-text">{fmt(start)}</span>
        </span>
        <span>
          {t("clipedit.end")}: <span className="font-semibold text-text">{fmt(range.out_ms)}</span>
        </span>
        <span>
          {t("clipedit.length")}: <span className="font-semibold text-text">{formatClipLength(range.out_ms - start)}</span>
        </span>
        {!keyframes.length && <span className="text-dim">{t("clipedit.no_keyframes")}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="subtle" icon={previewing ? <Pause size={13} /> : <Play size={13} />} onClick={preview}>
          {previewing ? t("clipedit.stop") : t("clipedit.preview")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setIn(Math.round(pos * 1000))}>
          {t("clipedit.start_here")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOut(Math.round(pos * 1000))}>
          {t("clipedit.end_here")}
        </Button>
        {hint && (
          <Button size="sm" variant="ghost" icon={<Wand2 size={13} />} onClick={() => setRange({ in_ms: hint.in_ms, out_ms: Math.min(hint.out_ms, totalMs) })}>
            {t("clipedit.suggestion")}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setRange({ in_ms: 0, out_ms: totalMs })}>
          {t("clipedit.whole")}
        </Button>
      </div>

      {ffmpeg.data === false && (
        <p className="flex items-start gap-2 rounded-ctl bg-warn/[.08] px-3 py-2 text-[12.5px] text-warn">
          <Info size={14} className="mt-px shrink-0" />
          {t("clipedit.no_ffmpeg")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Checkbox checked={deleteOriginal} onChange={setDeleteOriginal} label={t("clipedit.delete_original")} disabled={clip.kept} />
        <div className="flex-1" />
        <Button size="sm" variant="ghost" disabled={!dirty && !!clip.trim} loading={busy === "save"} onClick={save}>
          {t("clipedit.remember")}
        </Button>
        <Button size="sm" variant="primary" icon={<Scissors size={13} />} disabled={whole || ffmpeg.data === false || busy !== null} loading={busy === "export"} onClick={exportClip}>
          {t("clipedit.export")}
        </Button>
      </div>
      <p className={cn("-mt-1 text-[12px] text-dim", !clip.kept && "hidden")}>{t("clipedit.kept_hint")}</p>
    </div>
  );
}
