// Kleine gemeinsame Bausteine der Bedrock-Oberfläche.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Info, RotateCcw } from "lucide-react";
import type { BedrockChannel, Instance } from "@/lib/types";
import { Button, Tag, cn, toast } from "@/components/ui";
import { PixelBlock } from "@/components/instance/InstanceIcon";
import { useRunPhase } from "@/components/instance/status";
import { useT } from "@/i18n";
import { bedrockApi, bqk, channelStatus, type BedrockPackKind, type BedrockStatus } from "./api";

/** Bedrock-Farbe (Kennzeichnung in Bibliothek/Sidebar). */
export const BEDROCK_COLOR = "#7fb0ff";

export function BedrockTag({ instance, className }: { instance: Pick<Instance, "bedrock">; className?: string }) {
  const t = useT();
  if (!instance.bedrock) return null;
  return (
    <Tag color={BEDROCK_COLOR} className={cn("shrink-0", className)}>
      {instance.bedrock.channel === "preview" ? t("bedrock.tag_preview") : t("bedrock.tag")}
    </Tag>
  );
}

/** Kurztext „Bedrock“ / „Bedrock Preview“ für Meta-Zeilen. */
export function bedrockLine(i: Pick<Instance, "bedrock">, t: (k: string) => string): string {
  return i.bedrock?.channel === "preview" ? t("bedrock.name_preview") : t("bedrock.name");
}

const KIND_COLORS: Record<BedrockPackKind, string> = {
  resource: "#5aa9ff",
  behavior: "#ffb547",
  skin: "#ff6b9a",
  world_template: "#7ee07a",
};

export function PackKindTag({ kind }: { kind: BedrockPackKind }) {
  const t = useT();
  return <Tag color={KIND_COLORS[kind]}>{t(`bedrock.kind.${kind}`)}</Tag>;
}

export function DataIcon({ src, color = "#5fbf4a", size = 36 }: { src: string | null; color?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="grid shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface2" style={{ width: size, height: size }}>
      {src && !failed ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(true)} className="h-full w-full object-cover [image-rendering:pixelated]" />
      ) : (
        <PixelBlock color={color} size={Math.round(size * 0.66)} />
      )}
    </div>
  );
}

/** Hinweis „nicht installiert“ mit Store-Link. */
export function NotInstalledNotice({ channel, className, compact }: { channel: BedrockChannel; className?: string; compact?: boolean }) {
  const t = useT();
  return (
    <div className={cn("flex items-center gap-3 rounded-card bg-warn/[.08] px-4 py-3", className)}>
      <AlertTriangle size={17} className="shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-text">{t(channel === "preview" ? "bedrock.missing.title_preview" : "bedrock.missing.title")}</div>
        {!compact && <div className="text-[12.5px] text-muted">{t("bedrock.missing.text")}</div>}
      </div>
      <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => bedrockApi.openStore(channel).catch((e) => toast.error(e))}>
        {t("bedrock.missing.store")}
      </Button>
    </div>
  );
}

/** Ein Profil-Tausch ist offen, ohne dass das Spiel läuft (z. B. nach Absturz): von Hand abschließen. */
export function PendingSwapNotice({ status, channel, running }: { status: BedrockStatus | undefined; channel: BedrockChannel; running: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const cs = channelStatus(status, channel);
  // Die eingetauschte Instanz startet gerade oder läuft -> kein offener Tausch
  const other = useRunPhase(cs?.active_instance ?? "");
  if (!cs?.active_instance || cs.running || running || other.phase !== "idle") return null;
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface2 px-4 py-3">
      <Info size={17} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-text">{t("bedrock.pending.title")}</div>
        <div className="text-[12.5px] text-muted">{t("bedrock.pending.text")}</div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        icon={<RotateCcw size={13} />}
        onClick={async () => {
          setBusy(true);
          try {
            await bedrockApi.recover(channel);
            toast.success(t("bedrock.pending.done"));
          } catch (e) {
            toast.error(e, t("bedrock.pending.failed"));
          } finally {
            setBusy(false);
            qc.invalidateQueries({ queryKey: bqk.status });
            qc.invalidateQueries({ queryKey: ["content"] });
          }
        }}
      >
        {t("bedrock.pending.action")}
      </Button>
    </div>
  );
}
