import { useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Button, Field, Input, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { remoteApi } from "../api";
import { groupFingerprint } from "../install";
import type { AgentProbe, RemoteAgent } from "../types";

export function DirectConnect({ onDone, onBusy }: { onDone: (a: RemoteAgent) => void; onBusy: (b: boolean) => void }) {
  const t = useT();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [probe, setProbe] = useState<AgentProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as { message?: string })?.message ?? String(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  const check = () => run(async () => setProbe(await remoteApi.probe(address)));
  const pair = () =>
    run(async () => {
      if (!probe) return;
      const a = await remoteApi.pair(probe.address, code, probe.fingerprint);
      toast.success(t("rmt.done.title", { name: a.name }));
      onDone(a);
    });

  const codeOk = code.replace(/[^a-z0-9]/gi, "").length >= 8;
  const groups = probe ? groupFingerprint(probe.fingerprint) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
        <Field label={t("rmt.direct.address")} hint={t("rmt.direct.address.hint")}>
          <Input
            autoFocus
            value={address}
            placeholder="192.168.1.20"
            spellCheck={false}
            disabled={!!probe || busy}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && address.trim() && !probe && void check()}
          />
        </Field>
        <Field label={t("rmt.direct.code")} hint={t("rmt.direct.code.hint")}>
          <Input
            value={code}
            placeholder="ABCD-EFGH"
            spellCheck={false}
            maxLength={12}
            className="font-mono uppercase tracking-wider"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && probe && codeOk && void pair()}
          />
        </Field>
      </div>

      {probe && (
        <div className="flex flex-col gap-3 rounded-card bg-surface p-4">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={18} className="shrink-0 text-ok" />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-text">{t("rmt.direct.found", { name: probe.info.name })}</div>
              <div className="text-meta text-muted">
                {t("rmt.direct.found.meta", { version: probe.info.version, os: [probe.info.os, probe.info.arch].filter(Boolean).join(" ") || "?" })}
                {" · "}
                {probe.address}
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-text">
              <ShieldCheck size={14} className="text-accent" />
              {t("rmt.direct.fp")}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-ctl bg-field px-3 py-2 font-mono text-[12px] text-muted">
              {groups.map((g, i) => (
                <span key={i} className={i === 0 ? "font-semibold text-text" : undefined}>
                  {g}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-dim">{t("rmt.direct.fp.hint")}</p>
          </div>
        </div>
      )}

      {error && <p className="rounded-card bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        {probe ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => (setProbe(null), setError(null))}>
              {t("rmt.direct.other")}
            </Button>
            <Button variant="primary" loading={busy} disabled={!codeOk} onClick={() => void pair()}>
              {t("rmt.direct.pair")}
            </Button>
          </>
        ) : (
          <Button variant="primary" loading={busy} disabled={!address.trim()} onClick={() => void check()}>
            {t("rmt.direct.check")}
          </Button>
        )}
      </div>
    </div>
  );
}
