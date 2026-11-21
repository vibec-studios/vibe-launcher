import { useQuery } from "@tanstack/react-query";
import { History, PackageOpen, RotateCcw, Trash2 } from "lucide-react";
import { Button, IconButton, SettingsCard, Skeleton, Tooltip, confirm, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { formatBytes, formatLoader, formatRelative } from "@/lib/format";
import { queryClient, sqk, useServerStatus, isServerActive, waitForTask } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { serverTargetKey } from "@/features/installtarget/registry";
import { packApi, pqk, type PackSnapshot } from "./api";
import { openPackToServer } from "./store";

async function restore(server: Server, s: PackSnapshot) {
  const ok = await confirm({ title: tt("sp.restore.title"), text: tt("sp.restore.text", { when: formatRelative(s.created) }), confirmLabel: tt("sp.restore.confirm") });
  if (!ok) return;
  try {
    const id = await packApi.restore(server.id, s.name);
    await waitForTask(id);
    toast.success(tt("sp.restore.done"), server.name);
  } catch (e) {
    toast.error(e);
  } finally {
    void queryClient.invalidateQueries({ queryKey: pqk.status(server.id) });
    void queryClient.invalidateQueries({ queryKey: sqk.servers });
    void queryClient.invalidateQueries({ queryKey: ["server-addons", server.id] });
  }
}

async function remove(server: Server, s: PackSnapshot) {
  const ok = await confirm({ title: tt("sp.snap.delete_title"), text: tt("sp.snap.delete_text"), confirmLabel: tt("common.delete"), danger: true });
  if (!ok) return;
  try {
    await packApi.deleteSnapshot(server.id, s.name);
  } catch (e) {
    toast.error(e);
  } finally {
    void queryClient.invalidateQueries({ queryKey: pqk.status(server.id) });
  }
}

export function PackCard({ server }: { server: Server }) {
  const t = useT();
  const running = isServerActive(useServerStatus(server.id));
  const q = useQuery({ queryKey: pqk.status(server.id), queryFn: () => packApi.status(server.id), staleTime: 30_000 });
  const m = q.data?.manifest;
  const snaps = q.data?.snapshots ?? [];
  return (
    <SettingsCard
      title={t("sp.card.title")}
      right={
        <Button size="sm" variant="subtle" icon={<PackageOpen size={14} />} onClick={() => openPackToServer({ serverKey: serverTargetKey({ origin: "local", id: server.id }) })}>
          {m ? t("sp.card.update") : t("sp.card.apply")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-4" data-testid="pack-card">
        {!q.data ? (
          <Skeleton className="h-10" />
        ) : m ? (
          <div className="text-[13px] text-muted">
            {t("sp.card.current")} <b className="font-semibold text-text">{m.name}</b>
            {m.version_name && <span className="ml-1.5 text-dim">{m.version_name}</span>}
            <span className="block text-[12px] text-dim">
              {[m.loader ? `${formatLoader(m.loader)} · Minecraft ${m.mc_version}` : `Minecraft ${m.mc_version}`, t("sp.card.files", { n: m.files.length }), formatRelative(m.applied_at)].join(" · ")}
            </span>
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted">{t("sp.card.text")}</p>
        )}
        {snaps.length > 0 && (
          <div className="flex flex-col">
            <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-dim">
              <History size={13} />
              {t("sp.card.snapshots")}
            </span>
            {snaps.slice(0, 5).map((s) => (
              <div key={s.name} className="group flex h-9 items-center gap-2 rounded-ctl px-2 hover:bg-white/[.03]">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">{s.label ?? s.name}</span>
                <span className="shrink-0 text-[11.5px] text-dim">
                  {formatRelative(s.created)} · {formatBytes(s.size)}
                </span>
                <Tooltip content={running ? t("sp.restore.stop_first") : t("sp.restore.title")}>
                  <span>
                    <IconButton label={t("sp.restore.title")} variant="ghost" size="sm" disabled={running} onClick={() => void restore(server, s)}>
                      <RotateCcw size={14} />
                    </IconButton>
                  </span>
                </Tooltip>
                <IconButton label={t("common.delete")} variant="ghost" size="sm" className="opacity-60 group-hover:opacity-100" onClick={() => void remove(server, s)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
