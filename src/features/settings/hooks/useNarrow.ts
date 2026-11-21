import { useEffect, useState } from "react";

const NARROW = "(max-width: 880px)";
/** Schmales Fenster: Tab-Leiste nur mit Icons (Tooltips zeigen die Namen). */
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
