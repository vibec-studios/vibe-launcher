// Wählt die Runner für Builds (Windows, Linux, macOS) – so, dass für Blacksmith nie bezahlt wird:
// Zählt den Blacksmith-Verbrauch der Organisation im laufenden Monat (in "2-vCPU-x64-Minuten", so rechnet
// Blacksmith ab: Windows x2, vCPU/2, ARM x0.625) über die GitHub-API. Liegt er unter dem Limit, wird der
// Blacksmith-Runner genutzt, sonst der kostenlose GitHub-Runner (öffentliche Repos zahlen dort nichts).
//
// Aufruf: node scripts/pick-runner.mjs [windows|linux|macos|all]   (Standard: all)
// Umgebung: GITHUB_TOKEN, GITHUB_REPOSITORY, optional:
//   FORCE_RUNNER / FORCE_LINUX_RUNNER / FORCE_MACOS_RUNNER   feste Runner (Repo-Variablen WINDOWS_RUNNER,
//                         LINUX_RUNNER, MACOS_RUNNER), z. B. "windows-latest"
//   BLACKSMITH_RUNNER     Standard "blacksmith-4vcpu-windows-2025"
//   BLACKSMITH_LINUX_RUNNER  Standard "blacksmith-4vcpu-ubuntu-2204"
//   FALLBACK_RUNNER       Standard "windows-latest"; Linux: "ubuntu-22.04"
//   BLACKSMITH_BUDGET     Freiminuten/Monat, Standard 3000
//   BLACKSMITH_RESERVE    Sicherheitsabstand für laufende/gleichzeitige Jobs, Standard 400
// macOS läuft immer auf dem kostenlosen GitHub-Runner (macos-latest).
// Ausgabe nach $GITHUB_OUTPUT: `runner=<windows>`, `linux=<label>`, `macos=<label>` (je nach OS-Argument).
import fs from "node:fs";

const env = process.env;
const which = (process.argv[2] || "all").toLowerCase();
const wanted = (os) => which === "all" || which === os;
const OS = {
  windows: {
    key: "runner",
    force: env.FORCE_RUNNER,
    blacksmith: env.BLACKSMITH_RUNNER || "blacksmith-4vcpu-windows-2025",
    fallback: env.FALLBACK_RUNNER || "windows-latest",
  },
  linux: {
    key: "linux",
    force: env.FORCE_LINUX_RUNNER,
    blacksmith: env.BLACKSMITH_LINUX_RUNNER || "blacksmith-4vcpu-ubuntu-2204",
    fallback: env.FALLBACK_LINUX_RUNNER || "ubuntu-22.04",
  },
  macos: { key: "macos", force: env.FORCE_MACOS_RUNNER, blacksmith: null, fallback: "macos-latest" },
};
const budget = Number(env.BLACKSMITH_BUDGET || 3000);
const reserve = Number(env.BLACKSMITH_RESERVE || 400);
const [owner] = (env.GITHUB_REPOSITORY || "vibec-studios/vibe-launcher").split("/");

function output(os, runner, why) {
  console.log(`Runner ${os}: ${runner} – ${why}`);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${OS[os].key}=${runner}\n`);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `**Runner ${os}:** \`${runner}\` – ${why}\n`);
}

/** Feste Runner und macOS sofort ausgeben; zurück bleiben die Systeme, für die Blacksmith infrage kommt. */
function decideFixed() {
  const open = [];
  for (const os of Object.keys(OS)) {
    if (!wanted(os)) continue;
    const o = OS[os];
    if (o.force) output(os, o.force, "fest eingestellt (Repo-Variable)");
    else if (!o.blacksmith) output(os, o.fallback, "kostenloser GitHub-Runner");
    else open.push(os);
  }
  return open;
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${env.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GitHub-API ${res.status} für ${path}`);
  return res.json();
}

/** Abrechnungsfaktor eines Blacksmith-Labels in 2-vCPU-x64-Minuten pro Minute (null = kein Blacksmith). */
export function factor(label) {
  const m = /^blacksmith-(\d+)vcpu-(.+)$/.exec(label);
  if (!m) return null;
  let f = Number(m[1]) / 2;
  if (/windows/.test(m[2])) f *= 2;
  else if (/arm/.test(m[2])) f *= 0.625;
  return f;
}

async function usedThisMonth() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since = monthStart.toISOString().slice(0, 10);
  const repos = [];
  for (let page = 1; ; page++) {
    const r = await gh(`/orgs/${owner}/repos?per_page=100&page=${page}`);
    repos.push(...r.map((x) => x.name));
    if (r.length < 100) break;
  }
  let total = 0;
  for (const repo of repos) {
    for (let page = 1; page <= 10; page++) {
      const runs = await gh(`/repos/${owner}/${repo}/actions/runs?per_page=100&page=${page}&created=%3E%3D${since}`);
      for (const run of runs.workflow_runs) {
        const jobs = await gh(`/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100&filter=all`);
        for (const job of jobs.jobs) {
          const f = (job.labels || []).map(factor).find((x) => x !== null);
          if (!f || !job.started_at) continue;
          const end = job.completed_at ? Date.parse(job.completed_at) : Date.now();
          const minutes = Math.ceil(Math.max(0, end - Date.parse(job.started_at)) / 60000);
          total += minutes * f;
        }
      }
      if (runs.workflow_runs.length < 100) break;
    }
  }
  return total;
}

const open = decideFixed();
if (open.length && !process.env.PICK_RUNNER_NO_RUN) {
  try {
    const used = await usedThisMonth();
    const limit = budget - reserve;
    for (const os of open) {
      if (used < limit) output(os, OS[os].blacksmith, `Blacksmith-Verbrauch diesen Monat ≈ ${used}/${budget} Freiminuten`);
      else output(os, OS[os].fallback, `Blacksmith-Freikontingent fast aufgebraucht (≈ ${used}/${budget}) – kostenloser GitHub-Runner`);
    }
  } catch (e) {
    // Im Zweifel nie Geld riskieren: kostenloser GitHub-Runner
    for (const os of open) output(os, OS[os].fallback, `Verbrauch nicht ermittelbar (${e.message}) – kostenloser GitHub-Runner`);
  }
}
