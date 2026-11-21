import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sleep } from "./stats.mjs";

const run = promisify(execFile);

const INFO_PS = [
  String.raw`$p=((powercfg /getactivescheme) -join ' ') -replace '^.*\((.*)\)\s*$','$1'`,
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
  "$o=Get-CimInstance Win32_OperatingSystem",
  "$c=Get-CimInstance Win32_Processor|Select-Object -First 1",
  "$g=@(Get-CimInstance Win32_VideoController|ForEach-Object Name)",
  "$d=@(Get-PhysicalDisk|ForEach-Object { \"$($_.FriendlyName) ($($_.MediaType), $($_.BusType))\" })",
  "$k='HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'",
  "$w=(Get-ItemProperty $k -ErrorAction SilentlyContinue).pv",
  "[pscustomobject]@{os=$o.Caption;build=$o.BuildNumber;cpu=$c.Name;cores=$c.NumberOfCores;threads=$c.NumberOfLogicalProcessors;gpu=$g;disks=$d;webview2=$w;plan=$p}|ConvertTo-Json -Depth 4 -Compress",
].join(";");

export async function systemInfo() {
  let extra = {};
  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command", INFO_PS], { windowsHide: true });
    extra = JSON.parse(stdout.trim());
  } catch {}
  return {
    platform: `${os.type()} ${os.release()}`,
    osName: extra.os ?? os.version(),
    osBuild: extra.build ?? null,
    cpu: (extra.cpu ?? os.cpus()[0]?.model ?? "").trim(),
    cores: extra.cores ?? null,
    threads: extra.threads ?? os.cpus().length,
    ramGb: +(os.totalmem() / 2 ** 30).toFixed(1),
    gpu: extra.gpu ?? [],
    disks: extra.disks ?? [],
    webview2Runtime: extra.webview2 ?? null,
    powerPlan: extra.plan ?? null,
    node: process.version,
  };
}

export async function backgroundLoad(probe, ms = 3000) {
  const a = await probe.sys();
  const top = await probe.topCpu(ms);
  const b = await probe.sys();
  const total = b.kernel - a.kernel + (b.user - a.user);
  const busy = total - (b.idle - a.idle);
  const cpuPct = total > 0 ? (busy / total) * 100 : 0;
  const freeGb = +(os.freemem() / 2 ** 30).toFixed(1);
  const javaPct = top.filter((t) => /^javaw?$/i.test(t.name)).reduce((s, t) => s + t.corePct, 0);
  const warnings = [];
  if (cpuPct > 10) warnings.push(`Hintergrundlast ${cpuPct.toFixed(0)} % CPU (gesamt) – Ergebnisse können verfälscht sein`);
  if (javaPct > 20) warnings.push(`Fremde Java-Prozesse aktiv (${javaPct.toFixed(0)} % eines Kerns) – evtl. läuft ein anderes Minecraft oder Gradle`);
  if (freeGb < 4) warnings.push(`Wenig freier Arbeitsspeicher (${freeGb} GB)`);
  return { at: new Date().toISOString(), cpuPct: +cpuPct.toFixed(1), freeGb, top, warnings };
}

export async function waitQuiet(probe, { maxPct = 10, maxWaitMs = 0, log = () => {} } = {}) {
  const end = Date.now() + maxWaitMs;
  for (;;) {
    const l = await backgroundLoad(probe, 2000);
    if (l.cpuPct <= maxPct || Date.now() >= end) return l;
    log(`  Hintergrundlast ${l.cpuPct} % – warte auf Ruhe …`);
    await sleep(5000);
  }
}
