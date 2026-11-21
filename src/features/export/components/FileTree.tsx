import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronRight, File, Folder, Minus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatBytes } from "@/lib/format";
import type { Node } from "../tree";

export function FileTree({ tree, sel, setSel }: { tree: Node[]; sel: Set<string>; setSel: (s: Set<string>) => void }) {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => {
    const out: Node[] = [];
    const walk = (n: Node) => {
      out.push(n);
      if (n.isDir && expanded.has(n.path)) n.children.forEach(walk);
    };
    tree.forEach(walk);
    return out;
  }, [tree, expanded]);
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => 36, overscan: 12 });

  const toggle = (n: Node) => {
    const next = new Set(sel);
    const all = n.leaves.every((l) => next.has(l));
    for (const l of n.leaves) all ? next.delete(l) : next.add(l);
    setSel(next);
  };

  if (!tree.length) return <div className="flex h-[80px] items-center justify-center rounded-card bg-surface text-meta text-dim">{t("export.no_files")}</div>;

  return (
    <div ref={ref} className="scroll h-[248px] rounded-card bg-surface py-1">
      <div className="relative" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((it) => {
          const n = rows[it.index];
          const on = n.leaves.filter((l) => sel.has(l)).length;
          const state = on === 0 ? "off" : on === n.leaves.length ? "on" : "mixed";
          const isOpen = expanded.has(n.path);
          return (
            <div
              key={n.path}
              className="absolute inset-x-0 flex h-9 items-center gap-1.5 pr-3 text-[14px] hover:bg-white/[.03]"
              style={{ top: it.start, paddingLeft: 8 + Math.min(n.depth, 12) * 18 }}
            >
              {n.isDir && n.children.length > 0 ? (
                <button
                  aria-label={isOpen ? t("export.collapse") : t("export.expand")}
                  className="grid h-5 w-5 place-items-center rounded-xs text-dim hover:text-text"
                  onClick={() => {
                    const next = new Set(expanded);
                    if (isOpen) next.delete(n.path);
                    else next.add(n.path);
                    setExpanded(next);
                  }}
                >
                  <ChevronRight size={13} className={cn("transition-transform duration-150", isOpen && "rotate-90")} />
                </button>
              ) : (
                <span className="w-5" />
              )}
              <button
                role="checkbox"
                aria-checked={state === "mixed" ? "mixed" : state === "on"}
                onClick={() => toggle(n)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-xs border transition-colors duration-100",
                    state === "off" ? "border-white/20" : "border-brand bg-brand text-[var(--ui-on-accent)]",
                  )}
                >
                  {state === "on" ? <Check size={11} strokeWidth={3} /> : state === "mixed" ? <Minus size={11} strokeWidth={3} /> : null}
                </span>
                {n.isDir ? <Folder size={14} className="shrink-0 text-muted" /> : <File size={14} className="shrink-0 text-dim" />}
                <span className={cn("truncate", state === "off" ? "text-muted" : "text-text")}>{n.name}</span>
              </button>
              <span className="shrink-0 text-caption tabular-nums text-dim">{formatBytes(n.size)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
