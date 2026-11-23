import { useEffect, useMemo } from "react";
import { useRouterState } from "@tanstack/react-router";
import { applyPalette, cachedAppearance, useLiveAppearance } from "@/lib/appearance";
import { useSettings } from "@/lib/queries";
import type { Appearance } from "@/lib/types";
import type { CompiledTheme } from "@/lib/themes/compile";
import { compileTheme } from "@/lib/themes/compile";
import type { ThemeExtension } from "@/lib/customThemes";
import { setThemeStyle } from "./dom";
import { armCrashGuard, crashGuardTripped, installEmergencyKeys, reportThemeError, resetThemeExtensions } from "./emergency";
import { cacheExt, loadExt, pruneExts, setSafe, useThemeRuntime } from "./store";

const STYLE_ID = "vl-theme-css";
const PAUSED_ROUTES = ["/accounts"];
const compiledByRev = new Map<string, CompiledTheme>();
let pruned = false;

function activeRev(a: Appearance): { id: string; rev: string } | null {
  const ct = a.active_custom ? a.custom_themes.find((t) => t.id === a.active_custom) : undefined;
  return ct?.ext ? { id: ct.id, rev: ct.ext } : null;
}

function compiled(rev: string, ext: ThemeExtension): CompiledTheme {
  const hit = compiledByRev.get(rev);
  if (hit) return hit;
  const c = compileTheme(ext, "scoped");
  compiledByRev.clear();
  compiledByRev.set(rev, c);
  return c;
}

export function applyCachedThemeExt() {
  const act = activeRev(cachedAppearance());
  if (!act) return;
  if (crashGuardTripped(act.rev)) {
    setSafe(true);
    window.setTimeout(() => void resetThemeExtensions("crash"), 1500);
    return;
  }
  const entry = useThemeRuntime.getState().exts[act.id];
  if (!entry?.ext || entry.rev !== act.rev) return;
  try {
    const c = compiled(act.rev, entry.ext);
    setThemeStyle(STYLE_ID, c.css || null);
    useThemeRuntime.setState({ compiled: c });
    armCrashGuard(act.rev);
  } catch {
    setThemeStyle(STYLE_ID, null);
  }
}

export function ThemeHost() {
  const a = useLiveAppearance((s) => s.a);
  const safe = useThemeRuntime((s) => s.safe);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const paused = PAUSED_ROUTES.some((r) => path.startsWith(r));
  const act = safe ? null : activeRev(a);
  const entry = useThemeRuntime((s) => (act ? s.exts[act.id] : undefined));
  const ext = act && entry && entry.rev === act.rev ? entry.ext : undefined;
  const saved = useSettings().data?.appearance?.custom_themes;
  const loaded = !!saved;

  useEffect(() => installEmergencyKeys(), []);
  useEffect(() => {
    if (loaded && !pruned) {
      pruned = true;
      pruneExts((saved ?? []).map((t) => t.id));
    }
  }, [loaded]);
  useEffect(() => applyPalette(a, safe), [a, safe]);
  useEffect(() => {
    if (act && entry?.rev !== act.rev) void loadExt(act.id, act.rev);
  }, [act?.id, act?.rev, entry?.rev]);

  const result = useMemo(() => {
    if (!act || !ext) return null;
    try {
      return compiled(act.rev, ext);
    } catch {
      return "error" as const;
    }
  }, [act?.rev, ext]);

  useEffect(() => {
    if (result === "error") {
      setThemeStyle(STYLE_ID, null);
      useThemeRuntime.setState({ compiled: null });
      reportThemeError();
      return;
    }
    if (act && ext === undefined) return;
    useThemeRuntime.setState({ compiled: result });
    setThemeStyle(STYLE_ID, result?.css || null, paused);
    if (act && entry && result) {
      cacheExt(act.id, entry);
      armCrashGuard(act.rev);
    } else if (!safe && !act) cacheExt(null);
  }, [result]);

  useEffect(() => {
    useThemeRuntime.setState({ paused });
    const c = useThemeRuntime.getState().compiled;
    setThemeStyle(STYLE_ID, c?.css || null, paused);
  }, [paused]);

  return null;
}
