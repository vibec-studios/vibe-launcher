import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ClipboardCopy, Copy, TextSelect, UploadCloud } from "lucide-react";
import type { LogLine } from "@/lib/types";
import { ContextItem, ContextMenu, ContextSeparator, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { copyText, formatLine, formatLines } from "../logText";
import { LogRow } from "./LogRow";

// ------------------------------------------------------------------ Viewer

/** Virtualisierte Log-Ansicht (auch für die Server-Konsole genutzt). */
export function LogViewer({
  lines,
  q,
  currentIdx,
  wrap,
  startAtTop,
  resetKey,
  jumpTo,
  onUpload,
  emptyText,
}: {
  lines: LogLine[];
  q: string;
  currentIdx: number | null;
  wrap: boolean;
  startAtTop: boolean;
  resetKey: string;
  jumpTo: { row: number } | null;
  onUpload: () => void;
  /** Text (wie bisher) oder ein eigener Leerzustand */
  emptyText: ReactNode;
}) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(!startAtTop);
  const followRef = useRef(!startAtTop);
  const menuLine = useRef<LogLine | null>(null);
  const [, force] = useState(0);

  const v = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 20,
    measureElement: wrap ? (el) => el.getBoundingClientRect().height : undefined,
  });

  // Neue Quelle: oben (Crash-Report) oder unten (Logs) beginnen
  useLayoutEffect(() => {
    followRef.current = !startAtTop;
    setFollow(!startAtTop);
    const el = scrollRef.current;
    if (el) el.scrollTop = startAtTop ? 0 : el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    v.measure();
  }, [wrap, v]);

  // Am Ende kleben, solange der Nutzer nicht hochscrollt
  const total = v.getTotalSize();
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [lines.length, total]);

  // Beim Lesen weiter oben bleibt die oberste Zeile stehen, auch wenn vorne alte Zeilen aus dem Puffer
  // fallen oder der Filter wechselt.
  const anchor = useRef<{ seq: number; offset: number } | null>(null);
  const linesRef = useRef(lines);
  useLayoutEffect(() => {
    const prev = linesRef.current;
    linesRef.current = lines;
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a || followRef.current || prev === lines || !lines.length) return;
    if (prev[0]?.seq === lines[0]?.seq && prev.length <= lines.length && !wrap) return; // nur angehängt
    let lo = 0,
      hi = lines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].seq < a.seq) lo = mid + 1;
      else hi = mid;
    }
    if (wrap) v.scrollToIndex(Math.min(lo, lines.length - 1), { align: "start" });
    else el.scrollTop = lo * 20 + a.offset;
  }, [lines, wrap, v]);

  // Suchtreffer anspringen
  useEffect(() => {
    if (!jumpTo) return;
    followRef.current = false;
    setFollow(false);
    v.scrollToIndex(jumpTo.row, { align: "center" });
  }, [jumpTo, v]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    const top = Math.max(0, el.scrollTop - 8);
    const first = wrap ? v.getVirtualItems().find((it) => it.end > top) : undefined;
    const idx = wrap ? (first?.index ?? 0) : Math.floor(top / 20);
    const line = linesRef.current[idx];
    anchor.current = line ? { seq: line.seq, offset: wrap ? 0 : el.scrollTop - idx * 20 } : null;
    if (atBottom !== followRef.current) {
      followRef.current = atBottom;
      setFollow(atBottom);
    }
  }, [wrap, v]);

  const jumpDown = () => {
    followRef.current = true;
    setFollow(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const selectAll = () => {
    const el = innerRef.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(r);
  };

  // Dateien ohne Zeitstempel (Crash-Reports) ohne Zeit-/Level-Spalten zeigen
  const plain = useMemo(() => {
    for (let i = 0; i < Math.min(lines.length, 300); i++) if (lines[i].time || lines[i].level === "launcher") return false;
    return lines.length > 0;
  }, [lines]);

  const selection = typeof window !== "undefined" ? (window.getSelection()?.toString() ?? "") : "";

  return (
    <div className="relative min-h-0 flex-1">
      <ContextMenu
        content={
          <>
            <ContextItem icon={<Copy size={14} />} disabled={!menuLine.current} onSelect={() => menuLine.current && copyText(formatLine(menuLine.current))}>
              {t("logs.copy_line")}
            </ContextItem>
            <ContextItem icon={<TextSelect size={14} />} disabled={!selection} shortcut="Strg+C" onSelect={() => copyText(selection)}>
              {t("logs.copy_selection")}
            </ContextItem>
            <ContextItem icon={<ClipboardCopy size={14} />} disabled={!lines.length} onSelect={() => copyText(formatLines(lines))}>
              {t("logs.copy_all")}
            </ContextItem>
            <ContextSeparator />
            <ContextItem icon={<UploadCloud size={14} />} disabled={!lines.length} onSelect={onUpload}>
              {t("logs.upload")}
            </ContextItem>
          </>
        }
      >
        <div
          ref={scrollRef}
          onScroll={onScroll}
          tabIndex={0}
          onContextMenu={(e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
            menuLine.current = row ? (lines[Number(row.dataset.index)] ?? null) : null;
            force((n) => n + 1);
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
              e.preventDefault();
              selectAll();
            } else if (e.key === "End") {
              e.preventDefault();
              jumpDown();
            } else if (e.key === "Home") {
              e.preventDefault();
              const el = scrollRef.current;
              if (el) el.scrollTop = 0;
            }
          }}
          className={cn("scroll h-full bg-bg py-2 outline-none", "focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]")}
        >
          {lines.length === 0 ? (
            typeof emptyText === "string" ? (
              <div className="grid h-full place-items-center px-6 text-center text-[13px] text-dim">{emptyText}</div>
            ) : (
              <div className="grid h-full place-items-center px-6">{emptyText}</div>
            )
          ) : (
            <div ref={innerRef} className="selectable relative w-full" style={{ height: total }}>
              {v.getVirtualItems().map((row) => (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={wrap ? v.measureElement : undefined}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <LogRow line={lines[row.index]} q={q} current={currentIdx === row.index} wrap={wrap} plain={plain} />
                </div>
              ))}
            </div>
          )}
        </div>
      </ContextMenu>
      {!follow && lines.length > 0 && (
        <button
          onClick={jumpDown}
          className="absolute bottom-4 right-6 flex h-9 items-center gap-2 rounded-ctl bg-surface3 px-3.5 text-[13px] font-semibold text-text shadow-e2 transition-colors duration-150 animate-pop-in hover:bg-accent hover:text-[var(--on-accent)]"
        >
          <ArrowDown size={13} />
          {t("logs.jump_bottom")}
        </button>
      )}
    </div>
  );
}
