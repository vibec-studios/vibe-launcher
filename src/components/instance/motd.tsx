// Minecraft-Servertexte: §-Farbcodes darstellen, Server-Status (Ping) als kompakte Zeile.
import { memo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Signal, SignalLow, SignalMedium, SignalZero, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { ServerStatus } from "@/lib/types";
import { Skeleton, cn } from "@/components/ui";
import { useT } from "@/i18n";

const COLORS: Record<string, string> = {
  "0": "#000000",
  "1": "#0000AA",
  "2": "#00AA00",
  "3": "#00AAAA",
  "4": "#AA0000",
  "5": "#AA00AA",
  "6": "#FFAA00",
  "7": "#AAAAAA",
  "8": "#555555",
  "9": "#5555FF",
  a: "#55FF55",
  b: "#55FFFF",
  c: "#FF5555",
  d: "#FF55FF",
  e: "#FFFF55",
  f: "#FFFFFF",
};

/** Text mit §-Codes (inkl. §#rrggbb) in farbige Spans zerlegen. */
export function formatMotd(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let color: string | null = null;
  let bold = false,
    italic = false,
    underline = false,
    strike = false;
  let buf = "";
  let key = 0;
  const flush = () => {
    if (!buf) return;
    out.push(
      <span
        key={key++}
        style={{
          color: color ?? undefined,
          fontWeight: bold ? 700 : undefined,
          fontStyle: italic ? "italic" : undefined,
          textDecoration: [underline && "underline", strike && "line-through"].filter(Boolean).join(" ") || undefined,
        }}
      >
        {buf}
      </span>,
    );
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "§" && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      if (code === "#" && /^[0-9a-f]{6}$/i.test(text.slice(i + 2, i + 8))) {
        flush();
        color = `#${text.slice(i + 2, i + 8)}`;
        bold = italic = underline = strike = false;
        i += 7;
        continue;
      }
      flush();
      if (COLORS[code]) {
        color = COLORS[code];
        bold = italic = underline = strike = false;
      } else if (code === "l") bold = true;
      else if (code === "o") italic = true;
      else if (code === "n") underline = true;
      else if (code === "m") strike = true;
      else if (code === "r") {
        color = null;
        bold = italic = underline = strike = false;
      }
      i++;
      continue;
    }
    buf += c;
  }
  flush();
  return out;
}

export const Motd = memo(function Motd({ text, className }: { text: string; className?: string }) {
  return <div className={cn("whitespace-pre-line break-words font-mono text-[12px] leading-snug text-[#AAAAAA]", className)}>{formatMotd(text)}</div>;
});

export function usePing(address: string | null, enabled = true) {
  return useQuery({
    queryKey: ["server-ping", address],
    queryFn: () => api.serverPing(address!),
    enabled: !!address && enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 0,
  });
}

export function PingBars({ status }: { status: ServerStatus | undefined }) {
  const t = useT();
  if (!status) return <SignalZero size={16} className="text-dim" />;
  if (!status.online) return <SignalZero size={16} className="text-danger" aria-label={t("servers.offline")} />;
  const ms = status.latency_ms ?? 999;
  const Icon = ms < 80 ? Signal : ms < 200 ? SignalMedium : SignalLow;
  return <Icon size={16} className={ms < 200 ? "text-ok" : "text-warn"} />;
}

/** Kompakte Zeile: Spieler · Version · Latenz (oder Fehler). */
export function ServerStatusLine({ address, className }: { address: string; className?: string }) {
  const t = useT();
  const q = usePing(address);
  if (q.isLoading) return <Skeleton className={cn("h-4 w-48", className)} />;
  const s = q.data;
  if (!s || !s.online)
    return <div className={cn("text-[12px] text-danger", className)}>{s?.error ? `${t("servers.offline")} · ${s.error}` : t("servers.offline")}</div>;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {s.motd && <Motd text={s.motd} />}
      <div className="flex items-center gap-3 text-[12px] text-muted">
        <PingBars status={s} />
        <span>{s.latency_ms} ms</span>
        {s.players_online != null && (
          <span className="flex items-center gap-1">
            <Users size={12} />
            {s.players_online}/{s.players_max}
          </span>
        )}
        {s.version && <span className="truncate font-mono text-[11px] text-dim">{s.version}</span>}
      </div>
    </div>
  );
}
