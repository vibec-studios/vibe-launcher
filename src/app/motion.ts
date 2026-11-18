// Gemeinsame Pausier-Logik für Hintergrund-Animationen und Schneefall: Fenster sichtbar? Spiel läuft?
// Bewegung reduziert (Launcher-Einstellung oder System)?
import { useEffect, useState } from "react";
import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isRunning, useGameStore, useSettings } from "@/lib/queries";

const useWin = create<{ visible: boolean }>(() => ({ visible: true }));
let watchers = 0;
let stopWatch: (() => void) | null = null;

/**
 * Fenster minimiert/versteckt? WebView2 meldet beim Minimieren weiter „visible“ – daher die Tauri-Fenster-API
 * (minimiert / versteckt, z. B. „Launcher beim Spielstart verstecken“): bei Größenänderung und alle 2 s.
 * Ein gemeinsamer Wächter für alle Nutzer (Hintergrund, Schnee …).
 */
function watchWindow() {
  if (import.meta.env.VITE_MOCK === "1") return () => {};
  if (watchers++ === 0) {
    let alive = true;
    const w = getCurrentWindow();
    const check = () =>
      Promise.all([w.isMinimized(), w.isVisible()])
        .then(([min, vis]) => alive && useWin.setState({ visible: !min && vis }))
        .catch(() => {});
    void check();
    const un = w.onResized(() => void check());
    const timer = setInterval(check, 2000);
    stopWatch = () => {
      alive = false;
      clearInterval(timer);
      void un.then((f) => f());
    };
  }
  return () => {
    if (--watchers === 0) {
      stopWatch?.();
      stopWatch = null;
    }
  };
}

export function usePageVisible() {
  const [docVisible, setDocVisible] = useState(() => document.visibilityState === "visible");
  const winVisible = useWin((s) => s.visible);
  useEffect(() => {
    const on = () => setDocVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  useEffect(() => watchWindow(), []);
  return docVisible && winVisible;
}

export function useSystemReducedMotion() {
  const [reduce, setReduce] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** still = nie animieren (Standbild), paused = gerade anhalten (unsichtbar / Spiel läuft). */
export function useMotion() {
  const visible = usePageVisible();
  const gameRunning = useGameStore((s) => Object.values(s.states).some((g) => isRunning(g)));
  const settingReduce = useSettings().data?.reduce_motion ?? false;
  const sysReduce = useSystemReducedMotion();
  const still = settingReduce || sysReduce;
  return { still, paused: still || !visible || gameRunning };
}

/** „Mehr Animationen“ aktiv (und nicht durch System/Einstellung reduziert)? Liest die Attribute an <html>. */
export function moreMotion(): boolean {
  const ds = document.documentElement.dataset;
  return ds.motion === "more" && ds.reduceMotion !== "true" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
