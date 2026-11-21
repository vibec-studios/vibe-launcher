import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HelpCircle, KeyRound, Server, Shield, Terminal } from "lucide-react";
import { AgentApi } from "@/api/client";
import type { Transport } from "@/api/transport";
import { IS_MOCK } from "@/app/runtime";
import { useT } from "@/i18n";
import { Button, Input, Notice } from "@/components/ui";
import { AsidePitch, AuthLayout, formatCode } from "./AuthLayout";

function browserName(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

export function LocalLogin({ transport, onToken }: { transport: Transport; onToken: (token: string) => void }) {
  const t = useT();
  const api = new AgentApi(transport);
  const info = useQuery({ queryKey: ["info-public"], queryFn: api.info, retry: 1 });
  const [code, setCode] = useState("");
  const [help, setHelp] = useState(false);
  const pair = useMutation({
    mutationFn: () => api.pair(code, `Panel (${browserName()})`),
    onSuccess: (r) => onToken(r.token),
  });
  const ready = code.replace("-", "").length === 8;
  return (
    <AuthLayout
      aside={
        <AsidePitch
          title={t("login.pitch")}
          points={[
            { icon: <Server size={19} />, title: t("login.p1.t"), text: t("login.p1.d") },
            { icon: <Terminal size={19} />, title: t("login.p2.t"), text: t("login.p2.d") },
            { icon: <Shield size={19} />, title: t("login.p3.t"), text: t("login.p3.d") },
          ]}
        />
      }
    >
      <div className="mb-6 grid size-12 place-items-center rounded-card bg-brand/15 text-accent">
        <KeyRound size={22} />
      </div>
      <h2 className="text-title font-bold">{t("login.title")}</h2>
      <p className="mt-1.5 text-[13.5px] text-muted">
        {info.data ? t("login.desc_named", { name: info.data.name }) : t("login.desc")}
      </p>
      <form
        className="mt-6 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) pair.mutate();
        }}
      >
        <label className="label" htmlFor="code">
          {t("login.code")}
        </label>
        <Input
          id="code"
          autoFocus
          autoComplete="one-time-code"
          spellCheck={false}
          placeholder="ABCD-EFGH"
          value={code}
          onChange={(e) => setCode(formatCode(e.target.value))}
          className="h-14 text-center font-mono text-[22px] font-semibold tracking-[0.2em]"
        />
        {pair.error && <Notice tone="danger">{(pair.error as Error).message}</Notice>}
        <Button type="submit" variant="primary" size="lg" loading={pair.isPending} disabled={!ready}>
          {t("login.connect")}
        </Button>
      </form>
      {IS_MOCK && <p className="mt-3 text-center text-meta text-warn">{t("login.mock_hint")}</p>}
      <button onClick={() => setHelp((v) => !v)} className="mt-6 flex items-center gap-1.5 text-meta font-medium text-muted hover:text-text">
        <HelpCircle size={15} />
        {t("login.where")}
      </button>
      {help && (
        <div className="mt-3 flex flex-col gap-2 rounded-card bg-surface2 p-4 text-meta text-muted">
          <p>{t("login.where.1")}</p>
          <p>
            {t("login.where.2")} <code className="rounded-xs bg-field px-1.5 py-0.5 font-mono text-text">vibe-agent pair</code>
          </p>
          <p>{t("login.where.3")}</p>
        </div>
      )}
    </AuthLayout>
  );
}
