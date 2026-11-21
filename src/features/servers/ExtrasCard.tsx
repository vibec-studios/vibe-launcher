// Sprachchat (Simple Voice Chat) und Bedrock-Freunde (Geyser + Floodgate) für einen Server (Vertrag 04/28).
// Schalter installieren/deaktivieren die Erweiterungen; über den Vibe-Relay zeigt die Karte Bedrock-Adresse und Port.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Gamepad2, Info, Mic } from "lucide-react";
import { api } from "@/lib/api";
import { useServerStatus } from "@/lib/queries";
import type { Server, ServerExtras, UdpStatus } from "@/lib/types";
import { SettingRow, SettingsCard, Spinner, Switch, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { AddressChip } from "./parts";

const key = (id: string) => ["server", id, "extras"] as const;

function UdpLine({ udp, channel }: { udp: UdpStatus | null | undefined; channel: "voice" | "bedrock" }) {
  const t = useT();
  if (!udp) return null;
  const denied = udp.denied.find((d) => d.channel === channel);
  const [tone, text] = denied
    ? (["danger", t(`srvx.denied.${denied.code === "no_port" || denied.code === "limit" ? denied.code : "disabled"}`)] as const)
    : udp.state === "ok"
      ? (["ok", t("srvx.udp.ok")] as const)
      : udp.state === "blocked"
        ? (["warn", t("srvx.udp.blocked")] as const)
        : udp.state === "unavailable" || udp.state === "off"
          ? (["danger", t("srvx.udp.unavailable")] as const)
          : (["muted", t("srvx.udp.connecting")] as const);
  return (
    <span className={cn("flex items-center gap-1.5 text-[12.5px]", { ok: "text-ok", warn: "text-warn", danger: "text-danger", muted: "text-muted" }[tone])}>
      {tone === "ok" ? <CheckCircle2 size={13} /> : tone === "muted" ? <Spinner size={11} /> : <AlertTriangle size={13} />}
      {text}
    </span>
  );
}

export function ExtrasCard({ server }: { server: Server }) {
  const t = useT();
  const qc = useQueryClient();
  const st = useServerStatus(server.id);
  const q = useQuery({ queryKey: key(server.id), queryFn: () => api.serverExtrasGet(server.id), staleTime: 30_000 });
  const [busy, setBusy] = useState<"voice" | "bedrock" | null>(null);
  const running = !!st && st.state !== "stopped" && st.state !== "crashed";
  const relay = server.connection === "relay";
  const tunnel = st?.tunnel?.kind === "relay" ? st.tunnel : null;
  const udp = tunnel?.udp ?? null;
  const x: ServerExtras | undefined = q.data;

  const toggle = async (what: "voice" | "bedrock", on: boolean) => {
    setBusy(what);
    try {
      const next = await api.serverExtrasSet(server.id, { [what]: on });
      qc.setQueryData(key(server.id), next);
      qc.invalidateQueries({ queryKey: ["server", server.id] });
      if (on) toast.success(t(what === "voice" ? "srvx.voice.on" : "srvx.bedrock.on"), t("srvx.on_text"));
    } catch (e) {
      toast.error(e, t("srvx.failed"));
    } finally {
      setBusy(null);
    }
  };

  const unsupported = (what: "voice" | "bedrock") => (what === "voice" ? x && !x.voice_supported : x && !x.bedrock_supported);

  return (
    <SettingsCard title={t("srvx.title")}>
      <SettingRow
        icon={<Mic size={16} className="text-muted" />}
        title={t("srvx.voice")}
        description={
          <>
            {unsupported("voice") ? t("srvx.voice.unsupported") : t("srvx.voice.desc")}
            {x?.voice && !x.voice_installed && <span className="mt-1 block text-warn">{t("srvx.missing")}</span>}
            {x?.voice && relay && running && (
              <span className="mt-1.5 block">
                <UdpLine udp={udp} channel="voice" />
              </span>
            )}
          </>
        }
      >
        {busy === "voice" ? (
          <Spinner size={14} />
        ) : (
          <Switch checked={!!x?.voice} disabled={!x || running || !!unsupported("voice") || busy !== null} onChange={(v) => toggle("voice", v)} label={t("srvx.voice")} />
        )}
      </SettingRow>
      <SettingRow
        icon={<Gamepad2 size={16} className="text-muted" />}
        title={t("srvx.bedrock")}
        description={
          <>
            {unsupported("bedrock") ? t("srvx.bedrock.unsupported") : t("srvx.bedrock.desc")}
            {x?.bedrock && !x.bedrock_installed && <span className="mt-1 block text-warn">{t("srvx.missing")}</span>}
            {x?.bedrock && relay && running && (
              <span className="mt-1.5 block">
                <UdpLine udp={udp} channel="bedrock" />
              </span>
            )}
          </>
        }
      >
        {busy === "bedrock" ? (
          <Spinner size={14} />
        ) : (
          <Switch checked={!!x?.bedrock} disabled={!x || running || !!unsupported("bedrock") || busy !== null} onChange={(v) => toggle("bedrock", v)} label={t("srvx.bedrock")} />
        )}
      </SettingRow>

      {x?.bedrock && relay && udp?.bedrock && (
        <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
          <span className="text-[12.5px] font-medium text-text">{t("srvx.bedrock.join")}</span>
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="label">{t("srvx.bedrock.address")}</span>
              <AddressChip address={udp.bedrock.host} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="label">{t("srvx.bedrock.port")}</span>
              <AddressChip address={String(udp.bedrock.port)} />
            </div>
          </div>
          <p className="text-[12px] leading-relaxed text-dim">{t("srvx.bedrock.howto")}</p>
        </div>
      )}

      {(running || (!relay && (x?.voice || x?.bedrock))) && (
        <p className="flex items-start gap-2 border-t border-line px-4 py-3 text-[12px] text-dim">
          <Info size={13} className="mt-px shrink-0" />
          {running ? t("srvx.stop_first") : t("srvx.local_hint")}
        </p>
      )}
    </SettingsCard>
  );
}
