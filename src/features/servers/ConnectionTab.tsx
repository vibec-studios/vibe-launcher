// Verbindung: Wie Freunde den Server erreichen (lokal/LAN, Vibe-Relay, playit.gg), Tunnel-Status,
// öffentliche Adresse, Claim-Link (playit), Tunnel zurücksetzen. Der Relay ist immer der offizielle Vibey-Relay.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ExternalLink, Globe, Home, Info, Radio, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient, sqk, useServerStatus, useSettings } from "@/lib/queries";
import type { Server, ServerConnection, ServerPatch, TunnelStatus } from "@/lib/types";
import { Button, SettingRow, SettingsCard, Skeleton, Spinner, confirm, cn, toast } from "@/components/ui";
import { SaveIndicator, useAutoSave } from "@/components/instance/forms";
import { useT } from "@/i18n";
import { HostingInvite } from "@/features/social/HostingInvite";
import { useAccessBlocked } from "@/features/access/hooks";
import { AddressChip } from "./parts";
import { ConnBadge, LanHint } from "./LanHint";

const applyServer = (base: Server, p: ServerPatch): Server => ({ ...base, ...p }) as Server;

function Option({
  value,
  current,
  icon,
  title,
  text,
  disabled,
  extra,
  badge,
  onSelect,
}: {
  value: ServerConnection;
  current: ServerConnection;
  icon: ReactNode;
  title: string;
  text: string;
  disabled?: boolean;
  extra?: ReactNode;
  badge?: ReactNode;
  onSelect: (v: ServerConnection) => void;
}) {
  const active = value === current;
  return (
    <div
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && !active && onSelect(value)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && !active && onSelect(value)}
      className={cn(
        "flex gap-3 border-line px-4 py-3 outline-none transition-colors duration-100 first:rounded-t-card last:rounded-b-card [&+&]:border-t",
        "focus-visible:bg-white/[.04]",
        disabled ? "cursor-not-allowed" : !active && "cursor-pointer hover:bg-white/[.03]",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-pill border-2",
          active ? "border-accent" : "border-white/20",
          disabled && "opacity-40",
        )}
      >
        {active && <span className="h-1.5 w-1.5 rounded-pill bg-accent" />}
      </span>
      <div className={cn("min-w-0 flex-1", disabled && "opacity-50")}>
        <div className={cn("flex items-center gap-2 text-[13.5px] font-semibold", active ? "text-text" : "text-text/90")}>
          <span className="text-muted">{icon}</span>
          {title}
          {badge}
        </div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-muted">{text}</div>
      </div>
      {extra && <div className="shrink-0 self-center">{extra}</div>}
    </div>
  );
}

function TunnelLine({ tunnel, running }: { tunnel: TunnelStatus | null | undefined; running: boolean }) {
  const t = useT();
  if (!running || !tunnel || tunnel.state === "stopped")
    return (
      <span className="flex items-center gap-2 text-[13px] text-dim">
        <span className="h-2 w-2 rounded-dot bg-dim" />
        {t("srv.conn.tunnel.idle")}
      </span>
    );
  const map = {
    connecting: { icon: <Spinner size={11} />, cls: "text-warn", label: t("srv.conn.tunnel.connecting") },
    online: { icon: <CheckCircle2 size={14} />, cls: "text-ok", label: t("srv.conn.tunnel.online") },
    claim: { icon: <AlertTriangle size={14} />, cls: "text-warn", label: t("srv.conn.tunnel.claim") },
    error: { icon: <AlertTriangle size={14} />, cls: "text-danger", label: t("srv.conn.tunnel.error") },
  } as const;
  const m = map[tunnel.state];
  return (
    <span className={cn("flex items-center gap-2 text-[13px] font-medium", m.cls)}>
      {m.icon}
      {m.label}
    </span>
  );
}

export function ConnectionTab({ server }: { server: Server }) {
  const t = useT();
  const nav = useNavigate();
  const st = useServerStatus(server.id);
  const { data: settings } = useSettings();
  const addrs = useQuery({ queryKey: sqk.addresses(server.id), queryFn: () => api.serverAddresses(server.id), staleTime: 60_000 });
  const { draft: d, update, state } = useAutoSave(server, applyServer, async (p: ServerPatch) => {
    const next = await api.serverUpdate(server.id, p);
    queryClient.setQueryData(sqk.server(server.id), next);
  });
  const [resetting, setResetting] = useState(false);

  const accessBlocked = useAccessBlocked();
  const relayOk = !!settings?.vibe.enabled && !!settings?.vibe.hosting && !accessBlocked;
  const running = st?.state === "running" || st?.state === "starting";
  const tunnel = st?.tunnel && st.tunnel.kind === d.connection ? st.tunnel : null;
  const usesTunnel = d.connection !== "local";
  const publicAddr = usesTunnel ? (tunnel?.address ?? null) : null;
  const localAddr = addrs.data?.local ?? `localhost:${server.port}`;

  const reset = async () => {
    const ok = await confirm({
      title: d.connection === "relay" ? t("srv.conn.reset.relay.title") : t("srv.conn.reset.playit.title"),
      text: d.connection === "relay" ? t("srv.conn.reset.relay.text") : t("srv.conn.reset.playit.text"),
      confirmLabel: d.connection === "relay" ? t("srv.conn.reset.relay") : t("srv.conn.reset.playit"),
      danger: d.connection === "playit",
    });
    if (!ok) return;
    setResetting(true);
    try {
      await api.serverTunnelReset(server.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="relative h-full">
      <div className="pointer-events-none absolute bottom-4 right-8 z-10 rounded-ctl bg-overlay px-2 py-1 shadow-e2 empty:hidden">
        <SaveIndicator state={state} />
      </div>
      <div className="scroll h-full">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-5 px-6 py-5">
          <div className="flex flex-col gap-5">
            <SettingsCard title={t("srv.conn.mode")}>
              <div className="flex flex-col" role="radiogroup">
                <Option
                  value="local"
                  current={d.connection}
                  icon={<Home size={15} />}
                  title={t("srv.conn.local")}
                  text={t("srv.conn.local.text")}
                  badge={<ConnBadge tone="muted">{t("srvh.badge.lan")}</ConnBadge>}
                  onSelect={(v) => update({ connection: v })}
                />
                <Option
                  value="relay"
                  current={d.connection}
                  icon={<Radio size={15} />}
                  title={t("srv.conn.relay")}
                  text={relayOk ? t("srv.conn.relay.text") : accessBlocked ? t("access.relay") : t("srv.conn.relay.disabled")}
                  disabled={!relayOk && d.connection !== "relay"}
                  badge={relayOk ? <ConnBadge tone="accent">{t("srvh.badge.internet")}</ConnBadge> : undefined}
                  extra={
                    !relayOk && (
                      <Button size="sm" variant="subtle" icon={<SettingsIcon size={13} />} onClick={() => nav({ to: "/settings", search: { tab: "vibe" } })}>
                        {t("nav.settings")}
                      </Button>
                    )
                  }
                  onSelect={(v) => update({ connection: v })}
                />
                <Option
                  value="playit"
                  current={d.connection}
                  icon={<Globe size={15} />}
                  title={t("srv.conn.playit")}
                  text={t("srv.conn.playit.text")}
                  badge={!relayOk ? <ConnBadge tone="accent">{t("srvh.badge.internet")}</ConnBadge> : undefined}
                  onSelect={(v) => update({ connection: v })}
                />
              </div>
            </SettingsCard>
            <p className="-mt-3 flex items-start gap-2 px-1 text-[12px] text-dim">
              <Info size={13} className="mt-px shrink-0" />
              {t("srv.conn.only_running")}
            </p>
          </div>

          <div className="flex flex-col gap-5">
            <SettingsCard title={t("srv.conn.for_friends")} right={usesTunnel ? <TunnelLine tunnel={tunnel} running={running} /> : undefined}>
              <div className="flex flex-col gap-3 px-4 py-4">
                {usesTunnel ? (
                  publicAddr ? (
                    <>
                      <AddressChip address={publicAddr} large />
                      <HostingInvite serverId={server.id} relay={d.connection === "relay"} />
                    </>
                  ) : (
                    <div className="grid h-12 place-items-center rounded-card bg-surface2 text-[13px] text-dim">
                      {running ? t("srv.conn.waiting_address") : t("srv.conn.start_for_address")}
                    </div>
                  )
                ) : (
                  <>
                    <AddressChip address={addrs.data?.lan[0] ?? localAddr} large />
                    <p className="text-[12.5px] leading-relaxed text-muted">{t("srv.conn.local.friends")}</p>
                    <LanHint relayOk={relayOk} onSwitch={(v) => update({ connection: v })} />
                    {st?.state === "running" && <HostingInvite serverId={server.id} relay={false} />}
                  </>
                )}

                {tunnel?.state === "claim" && tunnel.claim_url && (
                  <div className="flex flex-col gap-3 rounded-card bg-warn/[.08] px-4 py-3">
                    <div className="flex items-start gap-2 text-[13px] text-warn">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <span>{t("srv.conn.claim.text")}</span>
                    </div>
                    <a
                      href={tunnel.claim_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-ctl bg-accent px-4 text-[13.5px] font-semibold text-[var(--on-accent)] transition-[filter] duration-150 hover:brightness-110"
                    >
                      <ExternalLink size={14} />
                      {t("srv.conn.claim.button")}
                    </a>
                  </div>
                )}

                {tunnel?.message && (
                  <p className={cn("selectable text-[12.5px]", tunnel.state === "error" ? "text-danger" : "text-muted")}>{tunnel.message}</p>
                )}

                {usesTunnel && (
                  <div className="flex items-center gap-3 border-t border-line pt-3">
                    <p className="min-w-0 flex-1 text-[12px] text-dim">
                      {d.connection === "relay" ? t("srv.conn.reset.relay.desc") : t("srv.conn.reset.playit.desc")}
                    </p>
                    <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={resetting} onClick={reset}>
                      {d.connection === "relay" ? t("srv.conn.reset.relay") : t("srv.conn.reset.playit")}
                    </Button>
                  </div>
                )}
              </div>
            </SettingsCard>

            <SettingsCard
              title={t("srv.conn.local_addresses")}
            >
              <SettingRow title={t("srv.conn.this_pc")} description={t("srv.conn.this_pc.desc")}>
                <AddressChip address={localAddr} className="w-[240px]" />
              </SettingRow>
              {(addrs.isLoading || !!addrs.data?.lan.length) && (
                <SettingRow title={t("srv.conn.lan")} description={t("srv.conn.lan.desc")}>
                  <div className="flex flex-col gap-1.5">
                    {addrs.isLoading ? (
                      <Skeleton className="h-7 w-[240px]" />
                    ) : (
                      addrs.data!.lan.map((a) => <AddressChip key={a} address={a} className="w-[240px]" />)
                    )}
                  </div>
                </SettingRow>
              )}
            </SettingsCard>
          </div>
        </div>
      </div>
    </div>
  );
}
