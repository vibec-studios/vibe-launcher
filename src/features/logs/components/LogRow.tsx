import { memo, type ReactNode } from "react";
import type { LogLine } from "@/lib/types";
import { cn } from "@/components/ui";
import { catOf, levelTag, type LevelCat } from "../logText";

// ------------------------------------------------------------------ Zeile

const catColor: Record<LevelCat, string> = {
  info: "text-[#d6d6dc]",
  warn: "text-warn",
  error: "text-danger",
  debug: "text-dim",
  launcher: "text-accent",
};

function highlight(text: string, q: string, current: boolean): ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const j = lower.indexOf(q, i);
    if (j === -1) break;
    if (j > i) out.push(text.slice(i, j));
    out.push(
      <mark key={k++} className={cn("text-black", current ? "bg-accent outline outline-1 outline-white" : "bg-warn/80")}>
        {text.slice(j, j + q.length)}
      </mark>,
    );
    i = j + q.length;
  }
  if (!out.length) return text;
  if (i < text.length) out.push(text.slice(i));
  return out;
}

export const LogRow = memo(function LogRow({ line, q, current, wrap, plain }: { line: LogLine; q: string; current: boolean; wrap: boolean; plain: boolean }) {
  const cat = catOf(line.level);
  return (
    <div
      className={cn(
        "flex gap-3 px-4 font-mono text-[12px] leading-5",
        current && "bg-accent/10 shadow-[inset_2px_0_0_var(--accent)]",
        cat === "error" && !current && "bg-danger/[.05]",
        wrap ? "whitespace-pre-wrap break-all py-px" : "h-5 whitespace-pre",
      )}
    >
      {!plain && (
        <>
          <span className="w-[58px] shrink-0 select-none text-dim/70">{line.time ?? ""}</span>
          <span className={cn("w-[50px] shrink-0 select-none text-[10px] font-semibold tracking-[.04em]", catColor[cat], cat === "info" && "text-dim")}>
            {line.time || line.level === "launcher" ? levelTag(line.level) : ""}
          </span>
        </>
      )}
      <span className={cn("min-w-0 flex-1", catColor[cat], !wrap && "overflow-hidden text-ellipsis")}>
        {line.logger && cat !== "launcher" && <span className="text-dim">[{line.logger}] </span>}
        {highlight(line.text, q, current)}
      </span>
    </div>
  );
});
