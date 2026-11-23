import type { AnalysisInfo, CrashAnalysis, Diagnosis, FixPlan } from "@/lib/types";
import instancepage from "./instancepage";
import { mockEmit, type Handlers } from "./util";

export const priority = 3;

const flag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const scenario = () => flag("vl.mock.vibefix") ?? "diagnosed";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let downloaded = false;

async function simulate() {
  const sc = scenario();
  if (sc === "disabled") return;
  mockEmit("vibefix://status", { phase: "checking", done: 0, total: 0 });
  await sleep(500);
  if (sc !== "unavailable" && (!downloaded || flag("vl.mock.vibefix.download") === "1")) {
    const total = 1_576_761;
    for (let i = 0; i <= 12; i++) {
      mockEmit("vibefix://status", { phase: "downloading", done: Math.round((total * i) / 12), total });
      await sleep(170);
    }
    downloaded = true;
  }
  if (sc !== "unavailable") {
    mockEmit("vibefix://status", { phase: "loading", done: 0, total: 0 });
    await sleep(300);
  }
  mockEmit("vibefix://status", { phase: "analyzing", done: 0, total: 0 });
  await sleep(700);
  mockEmit("vibefix://status", { phase: "done", done: 0, total: 0 });
}

function info(): AnalysisInfo {
  const sc = scenario();
  if (sc === "diagnosed" || sc === "unknown") {
    return { engine: "vibefix", status: sc, model_version: "3", crash_score: sc === "unknown" ? 0.91 : null, notice: null };
  }
  return { engine: "rules", status: null, model_version: null, crash_score: null, notice: sc === "disabled" ? "disabled" : sc === "error" ? "error" : "unavailable" };
}

const UNKNOWN: Diagnosis = {
  id: "unknown",
  confidence: 91,
  culprit: null,
  params: {},
  actions: [{ kind: "upload" }],
  evidence: null,
  source: null,
  line: null,
  rule: null,
  origin: "vibefix",
  model_cause: "unknown",
  model_confidence: 0.91,
};

const MODEL_CAUSES = ["mixin_conflict", "outdated_dependency"];

function annotate(list: Diagnosis[]): Diagnosis[] {
  const i = info();
  if (i.engine !== "vibefix") return list;
  if (i.status === "unknown") return [UNKNOWN, ...list.map((d) => ({ ...d, origin: "rules" as const }))];
  return list.map((d, n) =>
    n < MODEL_CAUSES.length
      ? { ...d, origin: n === 0 ? ("both" as const) : ("vibefix" as const), model_cause: MODEL_CAUSES[n], model_confidence: 0.49 - n * 0.02 }
      : { ...d, origin: "rules" as const },
  );
}

function plan(p: FixPlan): FixPlan {
  const i = info();
  if (i.status === "unknown") {
    return { ...p, causes: [UNKNOWN], steps: p.steps.filter((s) => s.cause == null), unfixable: p.unfixable.filter((u) => u.cause == null), analysis: i };
  }
  const steps = i.engine === "vibefix" ? p.steps.map((s) => (s.cause != null ? { ...s, confirm: true, selected: false } : s)) : p.steps;
  return { ...p, causes: annotate(p.causes ?? []), steps, analysis: i };
}

const base = instancepage as Handlers;

async function crashAnalysis(args: Record<string, unknown>): Promise<CrashAnalysis> {
  const diagnoses = (await base.crash_analyze(args)) as Diagnosis[];
  if (!diagnoses.length) return { diagnoses, info: { engine: "rules", status: null, model_version: null, crash_score: null, notice: null } };
  await simulate();
  return { diagnoses: annotate(diagnoses), info: info() };
}

export default {
  autofix_plan: async (args) => {
    const p = (await base.autofix_plan(args)) as FixPlan;
    if (!p.crash) return p;
    await simulate();
    return plan(p);
  },
  crash_analysis: crashAnalysis,
  crash_analyze: async (args) => (await crashAnalysis(args)).diagnoses,
  vibefix_status: () => ({
    enabled: scenario() !== "disabled",
    version: downloaded ? "3" : null,
    remote_version: "3",
    checked_at: downloaded ? Date.now() : null,
    loaded: downloaded,
  }),
  mclogs_preview: ({ content }) => String(content).replace(/steve/gi, "<user>"),
} satisfies Handlers;
