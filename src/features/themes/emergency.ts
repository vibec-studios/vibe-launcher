import { applyTheme, normalizeAppearance, useAppearanceDraft, useLiveAppearance } from "@/lib/appearance";
import { api } from "@/lib/api";
import { patchSettings } from "@/lib/mode";
import { qk, queryClient } from "@/lib/queries";
import type { Settings } from "@/lib/types";
import { toast } from "@/components/ui";
import { t } from "@/i18n";
import { setSafe, useThemeRuntime } from "./store";

const PENDING = "vl.theme.pending";
const START = performance.now();
export type ResetReason = "shortcut" | "error" | "start" | "crash";

let resetting = false;

export async function resetThemeExtensions(reason: ResetReason) {
  if (resetting) return;
  resetting = true;
  setSafe(true);
  try {
    const draft = useAppearanceDraft.getState().draft;
    if (draft?.active_custom) useAppearanceDraft.setState({ draft: applyTheme(draft, draft.theme) });
    const s = queryClient.getQueryData<Settings>(qk.settings) ?? (await api.settingsGet());
    const a = s?.appearance ? normalizeAppearance(s.appearance) : null;
    if (a?.active_custom) await patchSettings({ appearance: applyTheme(a, a.theme) });
    clearPending();
    toast.info(t("vt.reset.title"), t(`vt.reset.${reason}`), undefined, 9000);
  } catch (e) {
    toast.error(e, t("vt.reset.title"));
  } finally {
    resetting = false;
  }
}

export function reportThemeError() {
  void resetThemeExtensions("error");
}

export function crashGuardTripped(rev: string): boolean {
  try {
    return localStorage.getItem(PENDING) === rev;
  } catch {
    return false;
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING);
  } catch {
    return;
  }
}

export function armCrashGuard(rev: string) {
  try {
    localStorage.setItem(PENDING, rev);
  } catch {
    return;
  }
  window.setTimeout(() => {
    if (crashGuardTripped(rev)) clearPending();
  }, 4000);
}

export function installEmergencyKeys(): () => void {
  let shiftSeen = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === "Digit0") {
      e.preventDefault();
      e.stopPropagation();
      void resetThemeExtensions("shortcut");
      return;
    }
    if (!shiftSeen && e.key === "Shift" && performance.now() - START < 3000) {
      shiftSeen = true;
      const a = useLiveAppearance.getState().a;
      const ct = a.custom_themes.find((x) => x.id === a.active_custom);
      if (useThemeRuntime.getState().safe || !ct || (!ct.ext && !Object.keys(ct.palette ?? {}).length)) return;
      setSafe(true);
      toast.info(t("vt.safe.title"), t("vt.safe.text"), { label: t("vt.safe.reset"), onClick: () => void resetThemeExtensions("start") }, 12000);
    }
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pagehide", clearPending);
  return () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pagehide", clearPending);
  };
}
