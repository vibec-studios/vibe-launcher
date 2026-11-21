import type { FixAction, FixPlan, FixReport } from "@/lib/types";

/** Lässt sich etwas zurückstellen? Ohne Sicherung nur Java/RAM, Loader, Configs und vorgemerkte Downloads (wie `can_undo`). */
export function canUndo(r: FixReport) {
  return !!r.snapshot_id || !!r.prev_java || !!r.prev_loader || r.manual.length > 0 || (r.config_backups?.length ?? 0) > 0;
}

export type CauseStatus = "fixed" | "partial" | "failed" | "skipped" | "manual";

/** Ergebnis je Absturzursache aus den ausgeführten Schritten. */
export function causeStatus(i: number, plan: FixPlan, report: FixReport): CauseStatus {
  const steps = plan.steps.filter((s) => s.cause === i);
  if (!steps.length) return "manual";
  const same = (a: FixAction | null, b: FixAction) => !!a && JSON.stringify(a) === JSON.stringify(b);
  const ran = report.results.filter((r) => steps.some((s) => same(s.action, r.action) || same(s.alt, r.action)));
  if (!ran.length) return "skipped";
  const ok = ran.filter((r) => r.ok).length;
  return ok === ran.length ? "fixed" : ok > 0 ? "partial" : "failed";
}

export const statusStyle: Record<CauseStatus, string> = {
  fixed: "bg-ok/15 text-ok",
  partial: "bg-warn/15 text-warn",
  failed: "bg-danger/15 text-danger",
  skipped: "bg-white/[.06] text-muted",
  manual: "bg-warn/15 text-warn",
};

export type Verify = "running" | { open: number };
