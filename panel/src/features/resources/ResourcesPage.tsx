import { Cpu, HardDrive, MemoryStick, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { useAgent, useResources, useServers } from "@/app/agent";
import { bytes, duration, mib } from "@/app/format";
import { useT } from "@/i18n";
import { Card, Meter, Notice, Spinner } from "@/components/ui";
import { PageTitle } from "@/components/Shell";
import { StatusBadge } from "@/features/servers/parts";

function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className="h-14" />;
  const w = 240;
  const h = 56;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - Math.max(0, Math.min(1, v)) * (h - 4)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-14 w-full" role="img" aria-label={label}>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="color-mix(in srgb, var(--ui-accent) 14%, transparent)" />
      <polyline points={pts} fill="none" stroke="var(--ui-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Stat({ icon, label, value, children }: { icon: ReactNode; label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-meta text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-[26px] font-bold tabular-nums">{value}</div>
      {children}
    </Card>
  );
}

export function ResourcesPage() {
  const t = useT();
  const { info } = useAgent();
  const { data: r, history, error } = useResources();
  const servers = useServers();
  if (error && !r) return <Notice tone="danger">{(error as Error).message}</Notice>;
  if (!r) return <div className="flex justify-center py-20"><Spinner size={24} /></div>;
  const diskUsed = r.disk_total - r.disk_free;
  return (
    <>
      <PageTitle title={t("res.title")} desc={t("res.desc", { name: info.name })} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<Cpu size={15} />} label={t("res.cpu")} value={`${Math.round(r.cpu_percent)} %`}>
          <div className="mt-1 text-meta text-dim">{t("res.cores", { n: r.cpu_cores })}</div>
          <Spark values={history.map((h) => h.cpu / 100)} label={t("res.cpu_history")} />
        </Stat>
        <Stat icon={<MemoryStick size={15} />} label={t("res.ram")} value={bytes(r.mem_used)}>
          <div className="mt-1 text-meta text-dim">{t("res.of", { total: bytes(r.mem_total) })}</div>
          <Spark values={history.map((h) => h.mem)} label={t("res.ram_history")} />
        </Stat>
        <Stat icon={<HardDrive size={15} />} label={t("res.disk")} value={bytes(r.disk_free)}>
          <div className="mt-1 mb-4 text-meta text-dim">{t("res.free_of", { total: bytes(r.disk_total) })}</div>
          <Meter label={t("res.used")} value={diskUsed} max={r.disk_total} text={`${Math.round((diskUsed / r.disk_total) * 100)} %`} />
        </Stat>
        <Stat icon={<Timer size={15} />} label={t("res.uptime")} value={duration(r.uptime_s)}>
          <div className="mt-1 text-meta text-dim">
            {info.os} · {info.arch} · Agent {info.version}
          </div>
        </Stat>
      </div>
      <Card title={t("res.per_server")} className="mt-4" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-left text-meta text-muted">
                <th className="px-5 py-2 font-medium">{t("res.server")}</th>
                <th className="px-3 py-2 font-medium">{t("res.status")}</th>
                <th className="px-3 py-2 font-medium">{t("res.cpu")}</th>
                <th className="px-5 py-2 font-medium">{t("res.ram")}</th>
              </tr>
            </thead>
            <tbody>
              {(servers.data ?? []).map((s) => {
                const x = r.servers.find((y) => y.id === s.id);
                return (
                  <tr key={s.id} className="border-b border-line last:border-b-0">
                    <td className="px-5 py-3 font-medium">{s.name}</td>
                    <td className="px-3 py-3"><StatusBadge status={s.status} install={s.install_state} /></td>
                    <td className="px-3 py-3 tabular-nums">{x && x.cpu_percent ? `${Math.round(x.cpu_percent)} %` : "–"}</td>
                    <td className="w-64 px-5 py-3">
                      {x && x.mem_bytes ? <Meter label="" value={x.mem_bytes} max={(s.memory_mb ?? 2048) * 1_048_576} text={`${bytes(x.mem_bytes)} / ${mib(s.memory_mb ?? 2048)}`} /> : <span className="text-dim">–</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
