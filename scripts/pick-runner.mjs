// Wählt den Windows-Runner für Builds – so, dass für Blacksmith nie bezahlt wird:
// Zählt den Blacksmith-Verbrauch der Organisation im laufenden Monat (in "2-vCPU-x64-Minuten", so rechnet
// Blacksmith ab: Windows x2, vCPU/2, ARM x0.625) über die GitHub-API. Liegt er unter dem Limit, wird der
// Blacksmith-Runner genutzt, sonst der kostenlose GitHub-Runner (öffentliche Repos zahlen dort nichts).
//
// Umgebung: GITHUB_TOKEN, GITHUB_REPOSITORY, optional:
//   FORCE_RUNNER          fester Runner (Repo-Variable WINDOWS_RUNNER), z. B. "windows-latest"
//   BLACKSMITH_RUNNER     Standard "blacksmith-4vcpu-windows-2025"
//   FALLBACK_RUNNER       Standard "windows-latest"
//   BLACKSMITH_BUDGET     Freiminuten/Monat, Standard 3000
//   BLACKSMITH_RESERVE    Sicherheitsabstand für laufende/gleichzeitige Jobs, Standard 400
// Ausgabe: `runner=<label>` nach $GITHUB_OUTPUT.
import fs from "node:fs";

const env = process.env;
const blacksmith = env.BLACKSMITH_RUNNER || "blacksmith-4vcpu-windows-2025";
const fallback = env.FALLBACK_RUNNER || "windows-latest";
const budget = Number(env.BLACKSMITH_BUDGET || 3000);
const reserve = Number(env.BLACKSMITH_RESERVE || 400);
const [owner] = (env.GITHUB_REPOSITORY || "vibec-studios/vibe-launcher").split("/");

function output(runner, why) {
  console.log(`Runner: ${runner} – ${why}`);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `runner=${runner}\n`);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `**Runner:** \`${runner}\` – ${why}\n`);
}

if (env.FORCE_RUNNER) {
  output(env.FORCE_RUNNER, "fest eingestellt (Repo-Variable WINDOWS_RUNNER)");
  process.exit(0);
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

try {
  const used = await usedThisMonth();
  const limit = budget - reserve;
  if (used < limit) output(blacksmith, `Blacksmith-Verbrauch diesen Monat ≈ ${used}/${budget} Freiminuten`);
  else output(fallback, `Blacksmith-Freikontingent fast aufgebraucht (≈ ${used}/${budget}) – kostenloser GitHub-Runner`);
} catch (e) {
  // Im Zweifel nie Geld riskieren: kostenloser GitHub-Runner
  output(fallback, `Verbrauch nicht ermittelbar (${e.message}) – kostenloser GitHub-Runner`);
}
