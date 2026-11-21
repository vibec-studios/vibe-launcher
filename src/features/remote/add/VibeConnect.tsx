import { useEffect, useMemo, useRef, useState } from "react";
import { Check, KeyRound, Link2 } from "lucide-react";
import { Button, Input, Spinner, toast } from "@/components/ui";
import { useKnownApproved } from "@/features/access/hooks";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";
import { remoteApi } from "../api";
import { linkCommand, type InstallOs } from "../install";
import { freshVibeToken, loadAgents, useRemote } from "../store";
import type { LinkCode, RemoteAgent } from "../types";
import { CommandBox } from "./CommandBox";

const POLL_MS = 4000;

function useAgentArrival(active: boolean, until: number, onFound: (a: RemoteAgent) => void) {
  const known = useRef<Set<string> | null>(null);
  const cb = useRef(onFound);
  cb.current = onFound;
  useEffect(() => {
    if (!active) return;
    known.current ??= new Set(useRemote.getState().agents.filter((a) => a.via === "vibe").map((a) => a.key));
    const timer = setInterval(async () => {
      if (Date.now() > until) return clearInterval(timer);
      const list = await loadAgents(true);
      const fresh = list.find((a) => a.via === "vibe" && !known.current?.has(a.key));
      if (fresh) {
        clearInterval(timer);
        cb.current(fresh);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, until]);
}

export function VibeConnect({ os, onDone }: { os: InstallOs; onDone: (a: RemoteAgent) => void }) {
  const t = useT();
  const vibe = useVibe();
  const approved = useKnownApproved();
  const all = useRemote((s) => s.agents);
  const direct = useMemo(() => all.filter((a) => a.via === "direct" && !a.gateway_id && !all.some((v) => v.via === "vibe" && v.id === a.id)), [all]);
  const [claimCode, setClaimCode] = useState("");
  const claimOk = claimCode.replace(/[^a-z0-9]/gi, "").length === 8;
  const [code, setCode] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useAgentArrival(!!code, code?.expires_at ?? 0, (a) => {
    toast.success(t("rmt.done.title", { name: a.name }));
    onDone(a);
  });

  const gen = async (forAgent?: string) => {
    setBusy(forAgent ?? "gen");
    setError(null);
    try {
      await freshVibeToken();
      const c = await remoteApi.vibeLinkCode();
      if (forAgent) {
        await remoteApi.gatewayLink(forAgent, c.code);
        toast.success(t("rmt.vibe.linked"));
      }
      setCode(c);
    } catch (e) {
      setError((e as { message?: string })?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const claim = async () => {
    setBusy("claim");
    setError(null);
    try {
      await freshVibeToken();
      const a = await remoteApi.vibeClaim(claimCode);
      toast.success(t("rmt.done.title", { name: a.name }));
      onDone(a);
    } catch (e) {
      setError((e as { message?: string })?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!vibe.enabled || !approved) {
    return <p className="rounded-card bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted">{t("rmt.via.vibe.need")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13.5px] leading-relaxed text-muted">{t("rmt.vibe.lead")}</p>
      {code ? (
        <div className="flex flex-col gap-3 rounded-card bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="label">{t("rmt.vibe.code")}</div>
              <div className="select-all font-mono text-[22px] font-semibold tracking-wider text-text">{code.code}</div>
            </div>
            <div className="text-right text-meta text-dim">{t("rmt.vibe.expires", { time: new Date(code.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}</div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-muted">{t("rmt.vibe.cmd")}</span>
            <CommandBox command={linkCommand(os, code.code)} />
            <span className="text-[12px] text-dim">{t("rmt.vibe.or_panel")}</span>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner size={14} />
            {t("rmt.vibe.wait")}
          </div>
        </div>
      ) : (
        <div className="flex justify-start">
          <Button variant="primary" icon={<KeyRound size={15} />} loading={busy === "gen"} onClick={() => void gen()}>
            {t("rmt.vibe.gen")}
          </Button>
        </div>
      )}
      {!code && direct.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] text-muted">{t("rmt.vibe.direct_agents")}</span>
          {direct.map((a) => (
            <div key={a.key} className="flex items-center justify-between gap-3 rounded-card bg-surface px-3.5 py-2.5">
              <span className="min-w-0 truncate text-[13.5px] font-semibold text-text">{a.name}</span>
              <Button size="sm" variant="ghost" icon={<Link2 size={14} />} loading={busy === a.key} disabled={!!busy} onClick={() => void gen(a.key)}>
                {t("rmt.vibe.link")}
              </Button>
            </div>
          ))}
        </div>
      )}
      {!code && (
        <div className="flex flex-col gap-2 rounded-card bg-surface p-3.5">
          <span className="text-[12.5px] leading-relaxed text-muted">{t("rmt.vibe.claim.lead")}</span>
          <div className="flex items-center gap-2">
            <Input
              value={claimCode}
              onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
              placeholder="K7Q2-M9XD"
              maxLength={12}
              className="max-w-[180px] font-mono tracking-wider"
              onKeyDown={(e) => e.key === "Enter" && claimOk && void claim()}
            />
            <Button variant="ghost" icon={<Check size={14} />} disabled={!claimOk || !!busy} loading={busy === "claim"} onClick={() => void claim()}>
              {t("rmt.vibe.claim")}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="rounded-card bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
    </div>
  );
}
