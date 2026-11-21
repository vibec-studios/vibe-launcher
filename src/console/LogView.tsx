import { memo, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { catOf, levelTag, type LevelCat } from "@/features/logs/levels";
import type { LogLine } from "@/lib/types";

const color: Record<LevelCat, string> = {
  info: "var(--color-text)",
  warn: "var(--ui-warn)",
  error: "var(--ui-danger)",
  debug: "var(--color-muted)",
  launcher: "var(--ui-accent)",
};

function mark(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-warn/80 text-black">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const Row = memo(function Row({ line, q, wrap }: { line: LogLine; q: string; wrap: boolean }) {
  const cat = catOf(line.level);
  return (
    <div className={`flex gap-3 px-3 font-mono text-[12px] leading-5 ${wrap ? "whitespace-pre-wrap break-all" : "h-5 whitespace-pre"} ${cat === "error" ? "bg-danger/[.06]" : ""}`}>
      <span className="w-[58px] shrink-0 select-none text-dim">{line.time ?? ""}</span>
      <span className="w-[46px] shrink-0 select-none text-[10px] font-semibold" style={{ color: cat === "info" ? "var(--color-dim)" : color[cat] }}>
        {line.time || line.level === "launcher" ? levelTag(line.level) : ""}
      </span>
      <span className={`min-w-0 flex-1 ${wrap ? "" : "overflow-hidden text-ellipsis"}`} style={{ color: color[cat] }}>
        {line.logger && cat !== "launcher" && <span className="text-dim">[{line.logger}] </span>}
        {mark(line.text, q)}
      </span>
    </div>
  );
});

export function LogView({ lines, q, wrap, follow, onFollow }: { lines: LogLine[]; q: string; wrap: boolean; follow: boolean; onFollow: (v: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: lines.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 20,
    overscan: 30,
    getItemKey: (i) => lines[i]?.seq ?? i,
  });
  useEffect(() => {
    if (follow && lines.length) v.scrollToIndex(lines.length - 1, { align: "end" });
  }, [follow, lines.length, v]);
  return (
    <div
      ref={ref}
      className="scroll min-h-0 flex-1 overflow-auto bg-bg py-1"
      onWheel={(e) => e.deltaY < 0 && follow && onFollow(false)}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (!follow && el.scrollHeight - el.scrollTop - el.clientHeight < 4) onFollow(true);
      }}
    >
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((it) => (
          <div key={it.key} data-index={it.index} ref={wrap ? v.measureElement : undefined} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${it.start}px)` }}>
            <Row line={lines[it.index]} q={q} wrap={wrap} />
          </div>
        ))}
      </div>
    </div>
  );
}
