import fs from "node:fs";
import path from "node:path";
import { barChart, table, esc, slotOf } from "./chart.mjs";
import { css } from "./style.mjs";
import { manual } from "../adapters/index.mjs";

function latest(dir) {
  const out = {};
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^(setup|idle|install|launch|attach)-.*\.json$/.test(f)).sort() : [];
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    j.file = f;
    if (j.phase === "attach") { (out.attach ??= []).push(j); continue; }
    const prev = out[j.phase];
    out[j.phase] = { ...j, launchers: { ...(prev?.launchers ?? {}), ...j.launchers }, files: [...(prev?.files ?? []), f] };
  }
  return out;
}

const rowsOf = (res, pick) => Object.entries(res?.launchers ?? {}).map(([id, l]) => ({ id, label: l.name, s: l.summary ? pick(l.summary) : null }));
const fmtS = (ms) => (ms == null ? "–" : `${(ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} s`);
const med = (s, scale = 1, d = 1, unit = "") => (s ? `${(s.median / scale).toLocaleString("de-DE", { maximumFractionDigits: d })}${unit} (±${(s.sd / scale).toLocaleString("de-DE", { maximumFractionDigits: d })}, n=${s.n})` : "–");

function warningsOf(res) {
  const set = new Map();
  for (const l of Object.values(res?.launchers ?? {})) {
    for (const r of l.runs ?? []) {
      for (const b of [r.background, r.cold?.background, r.warm?.background].filter(Boolean)) for (const w of b.warnings ?? []) set.set(w.replace(/\d+ %/, "x %"), w);
    }
  }
  return [...set.values()];
}

function bgStats(res) {
  const v = [];
  for (const l of Object.values(res?.launchers ?? {})) for (const r of l.runs ?? []) if (r.background) v.push(r.background.cpuPct);
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  return { min: v[0], max: v[v.length - 1], median: v[Math.floor(v.length / 2)] };
}

export function buildReport(resultsDir) {
  const r = latest(resultsDir);
  const sys = (r.idle ?? r.install ?? r.setup ?? r.launch)?.meta?.system;
  const names = new Map();
  for (const p of [r.setup, r.idle, r.install, r.launch]) for (const [id, l] of Object.entries(p?.launchers ?? {})) names.set(id, `${l.name} ${l.version ?? ""}`.trim());
  const legend = `<div class="legend">${[...names].map(([id, n]) => `<span><i class="s${slotOf(id)}"></i>${esc(n)}</span>`).join("")}</div>`;
  const parts = [];

  parts.push(`<h1>Launcher-Vergleich</h1><p class="sub">Vibe Launcher im Vergleich mit anderen Minecraft-Launchern · erzeugt ${esc(new Date().toLocaleString("de-DE"))}</p>${legend}`);
  parts.push(`<p>Balken = Median, Linie = kleinster bis größter Wert. Überall gilt: <strong>kleiner ist besser</strong>. Mit der Maus über einen Balken fahren zeigt Streuung (IQR) und Anzahl der Läufe.</p>`);

  const warns = [r.idle, r.install, r.launch].flatMap(warningsOf);
  const bgs = [r.idle, r.install].map(bgStats).filter(Boolean);
  if (warns.length || bgs.some((b) => b.median > 10)) {
    parts.push(`<div class="warn"><strong>Hinweis zur Messqualität</strong><ul>${[...new Set(warns)].slice(0, 8).map((w) => `<li>${esc(w)}</li>`).join("")}${bgs.map((b) => `<li>Hintergrundlast vor den Läufen: Median ${b.median} %, Spanne ${b.min}–${b.max} % CPU</li>`).join("")}</ul><p>Die Zahlen sind deshalb nur vorläufig. Für belastbare Werte auf einem ruhigen System wiederholen.</p></div>`);
  }

  if (r.idle) {
    parts.push(`<h2>Start und Leerlauf</h2><p>„Fenster“ = erstes sichtbares Hauptfenster. „Bedienbar“ = Fenster sichtbar und die Prozesse sind zur Ruhe gekommen (CPU des Prozessbaums &lt; 10 % eines Kerns für 1 s). Erster Lauf mit leerem Datenordner („Erststart“) zählt nicht in den Median. RAM = Working Set aller Prozesse des Launchers (inkl. WebView2- bzw. Java-Kindprozesse).</p>`);
    parts.push(`<div class="grid2">${[
      barChart({ title: "Start bis Fenster sichtbar", unit: "s", scale: 1000, digits: 2, rows: rowsOf(r.idle, (s) => s.windowMs) }),
      barChart({ title: "Start bis bedienbar", unit: "s", scale: 1000, digits: 2, rows: rowsOf(r.idle, (s) => s.readyMs) }),
      barChart({ title: "Arbeitsspeicher 30 s nach Start (Working Set)", unit: "MiB", digits: 0, rows: rowsOf(r.idle, (s) => s.ram30MiB) }),
      barChart({ title: `Arbeitsspeicher nach ${r.idle.params.longMs / 60000} min Leerlauf`, unit: "MiB", digits: 0, rows: rowsOf(r.idle, (s) => s.ramLongMiB) }),
      barChart({ title: "Privater Speicher 30 s nach Start", unit: "MiB", digits: 0, rows: rowsOf(r.idle, (s) => s.private30MiB) }),
      barChart({ title: `CPU im Leerlauf (30 s – ${r.idle.params.longMs / 60000} min)`, unit: "% Kern", digits: 2, rows: rowsOf(r.idle, (s) => s.cpuLongPct) }),
    ].join("")}</div>`);
    parts.push(table(["Launcher", "Erststart Fenster", "Erststart bedienbar", "Fenster", "Bedienbar", "RAM 30 s", `RAM ${r.idle.params.longMs / 60000} min`, "CPU 10–30 s", "CPU Leerlauf"], Object.values(r.idle.launchers).map((l) => [`${l.name} ${l.version}`, fmtS(l.summary.firstStartWindowMs), fmtS(l.summary.firstStartReadyMs), med(l.summary.windowMs, 1000, 2, " s"), med(l.summary.readyMs, 1000, 2, " s"), med(l.summary.ram30MiB, 1, 0, " MiB"), med(l.summary.ramLongMiB, 1, 0, " MiB"), med(l.summary.cpu10to30Pct, 1, 2, " %"), med(l.summary.cpuLongPct, 1, 2, " %")])));
  }

  if (r.install) {
    const p = r.install.params;
    parts.push(`<h2>Instanzen anlegen</h2><p>Jeder Lauf startet mit leerem Datenordner (keine Caches). Vanilla ${esc(p.mcVersion)} und das Modpack <em>${esc(p.pack?.name)}</em> (${p.packIndex?.mods ?? "?"} Mods, ${((p.packIndex?.downloadBytes ?? 0) / 2 ** 20).toFixed(1)} MiB Downloads) per .mrpack-Import. Die Zeiten hängen stark von der Internetverbindung ab; die Launcher laufen abwechselnd, damit Schwankungen beide treffen.</p>`);
    const notes = Object.values(r.install.launchers).flatMap((l) => (l.summary?.notes ?? []).map((n) => `${l.name}: ${n}`));
    if (notes.length) parts.push(`<div class="warn"><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}<li>Beide Launcher laden beim Anlegen auch die Spieldateien (Client, Bibliotheken, Assets). Vibe in zwei Schritten (Instanz anlegen bzw. Mods importieren, dann installieren), Prism in einem. Verglichen werden deshalb die Gesamtzeiten bis spielbereit.</li><li>Gemessen mit Standardeinstellungen: Vibe lädt mit 16 parallelen Downloads, Prism mit 6. Gerade bei den rund 4.000 kleinen Asset-Dateien macht das viel aus. Gegenprobe mit gleicher Parallelität: <code>--prism-downloads 16</code>.</li></ul></div>`);
    parts.push(`<div class="grid2">${[
      barChart({ title: "Vanilla-Instanz bis spielbereit (leerer Datenordner)", unit: "s", scale: 1000, digits: 1, rows: rowsOf(r.install, (s) => s.vanillaTotalMs) }),
      barChart({ title: "Modpack (.mrpack) bis spielbereit (nach Vanilla)", unit: "s", scale: 1000, digits: 1, rows: rowsOf(r.install, (s) => s.packTotalMs) }),
      barChart({ title: "Plattenplatz Vanilla (Datenordner-Zuwachs)", unit: "MiB", digits: 0, rows: rowsOf(r.install, (s) => s.vanillaDataGrowthMiB) }),
      barChart({ title: "Plattenplatz Modpack (Zuwachs nach Vanilla)", unit: "MiB", digits: 0, rows: rowsOf(r.install, (s) => s.packDataGrowthMiB) }),
    ].join("")}</div>`);
    parts.push(table(["Launcher", "Vanilla: anlegen", "Vanilla: Spieldateien", "Modpack: Import", "Modpack: Spieldateien", "Instanzordner Vanilla", "Instanzordner Modpack", "Datenordner gesamt", "Fehler"], Object.values(r.install.launchers).map((l) => l.skipped ? [`${l.name} ${l.version}`, l.skipped, "", "", "", "", "", "", ""] : [`${l.name} ${l.version}`, med(l.summary.vanillaCreateMs, 1000, 2, " s"), med(l.summary.vanillaInstallMs, 1000, 1, " s"), med(l.summary.packImportMs, 1000, 1, " s"), med(l.summary.packInstallMs, 1000, 1, " s"), med(l.summary.vanillaInstanceMiB, 1, 1, " MiB"), med(l.summary.packInstanceMiB, 1, 1, " MiB"), med(l.summary.dataTotalMiB, 1, 0, " MiB"), (l.summary.errors ?? []).join("; ") || "–"])));
  }

  if (r.launch) {
    const p = r.launch.params;
    parts.push(`<h2>Spielstart bis Hauptmenü</h2><p>Gleiche Java (${esc(p.java)}), gleicher RAM (${p.memory.minMb}–${p.memory.maxMb} MiB). Gemessen vom Startbefehl bis zur Zeile „${esc(p.marker)}“ in <code>logs/latest.log</code>. Kalt = erster Spielstart nach Launcher-Start, warm = direkt danach.</p>`);
    const charts = [];
    for (const kind of p.kinds) {
      const label = kind === "pack" ? "Modpack" : "Vanilla";
      charts.push(barChart({ title: `${label}: kalt`, unit: "s", scale: 1000, digits: 1, rows: rowsOf(r.launch, (s) => s[kind]?.coldMs) }));
      charts.push(barChart({ title: `${label}: warm`, unit: "s", scale: 1000, digits: 1, rows: rowsOf(r.launch, (s) => s[kind]?.warmMs) }));
    }
    parts.push(`<div class="grid2">${charts.join("")}</div>`);
    parts.push(table(["Launcher", "Instanz", "allererster Start (inkl. Downloads)", "kalt", "warm", "RAM Spiel im Menü"], Object.values(r.launch.launchers).flatMap((l) => p.kinds.map((k) => [`${l.name} ${l.version}`, k, fmtS(l.summary?.[k]?.firstEverMs), med(l.summary?.[k]?.coldMs, 1000, 1, " s"), med(l.summary?.[k]?.warmMs, 1000, 1, " s"), med(l.summary?.[k]?.gameRamMiB, 1, 0, " MiB")]))));
  }

  if (r.setup) {
    parts.push(`<h2>Installationsgröße</h2>`);
    parts.push(`<div class="grid2">${barChart({ title: "Programmordner (entpackt)", unit: "MiB", digits: 1, rows: Object.entries(r.setup.launchers).map(([id, l]) => ({ id, label: l.name, s: { median: l.installBytes / 2 ** 20, min: l.installBytes / 2 ** 20, max: l.installBytes / 2 ** 20, p25: 0, p75: 0, n: 1 } })) })}</div>`);
    parts.push(table(["Launcher", "Version", "Download", "SHA-256", "Programmordner", "Hinweis"], Object.values(r.setup.launchers).map((l) => [l.name, l.version, `${(l.download.bytes / 2 ** 20).toFixed(1)} MiB · ${l.download.url}`, l.download.sha256, `${(l.installBytes / 2 ** 20).toFixed(1)} MiB / ${l.installFiles} Dateien`, (l.notes ?? []).join(" ")])));
  }

  for (const a of r.attach ?? []) {
    parts.push(`<h2>Manuell gemessen: ${esc(a.name)}</h2>`);
    parts.push(table(["Lauf", "Fenster", "Bedienbar", "RAM 30 s"], a.runs.map((x) => [x.run, fmtS(x.windowMs), fmtS(x.readyMs), x.mem30 ? `${x.mem30.workingSetMiB} MiB` : "–"])));
  }

  parts.push(`<h2>Nicht automatisch gemessen</h2>`);
  parts.push(table(["Launcher", "Warum", "Wie messen"], manual.map((m) => [m.name, m.reason, m.how])));

  if (sys) {
    parts.push(`<h2>System</h2>`);
    parts.push(table(["", ""], [["Betriebssystem", `${sys.osName} (Build ${sys.osBuild})`], ["CPU", `${sys.cpu} · ${sys.cores} Kerne / ${sys.threads} Threads`], ["RAM", `${sys.ramGb} GB`], ["GPU", (sys.gpu ?? []).join(", ")], ["Datenträger", (sys.disks ?? []).join(", ")], ["WebView2-Laufzeit", sys.webview2Runtime ?? "?"], ["Energiesparplan", sys.powerPlan ?? "?"], ["Node", sys.node]]));
  }
  parts.push(`<details><summary>Quelldateien</summary><ul>${[r.setup, r.idle, r.install, r.launch, ...(r.attach ?? [])].filter(Boolean).map((x) => `<li><code>${esc((x.files ?? [x.file]).join(", "))}</code> · ${esc(x.meta?.startedAt ?? "")}</li>`).join("")}</ul></details>`);

  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Launcher-Vergleich</title><style>${css}</style></head><body><main>${parts.join("\n")}</main></body></html>`;
  const file = path.join(resultsDir, "report.html");
  fs.writeFileSync(file, html);
  return file;
}
