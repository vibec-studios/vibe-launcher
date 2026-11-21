import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { LogLine } from "@/lib/types";

export function useLogSearch(lines: LogLine[], query: string, source: string) {
  const [curSeq, setCurSeq] = useState<number | null>(null);
  const [jump, setJump] = useState<{ row: number } | null>(null);
  const dq = useDeferredValue(query.trim().toLowerCase());
  const matches = useMemo(() => {
    if (!dq) return [] as number[];
    const m: number[] = [];
    for (let i = 0; i < lines.length; i++) if (lines[i].text.toLowerCase().includes(dq)) m.push(i);
    return m;
  }, [lines, dq]);
  // Aktueller Treffer über die Zeilennummer (seq) – Positionen verschieben sich, wenn der Puffer vorne kürzt
  const curPos = useMemo(() => (curSeq === null ? -1 : matches.findIndex((i) => lines[i].seq === curSeq)), [matches, lines, curSeq]);
  const curIdx = curPos >= 0 ? matches[curPos] : null;

  const go = (dir: 1 | -1) => {
    if (!matches.length) return;
    const from = curPos >= 0 ? curPos : dir === 1 ? -1 : 0;
    const next = (from + dir + matches.length) % matches.length;
    setCurSeq(lines[matches[next]].seq);
    setJump({ row: matches[next] });
  };
  useEffect(() => {
    if (matches.length) {
      setCurSeq(lines[matches[0]].seq);
      setJump({ row: matches[0] });
    } else setCurSeq(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, source]);

  return { dq, matches, curPos, curIdx, go, jump };
}
