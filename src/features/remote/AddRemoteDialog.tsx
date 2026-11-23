import { useState } from "react";
import { CheckCircle2, Cloud, Network } from "lucide-react";
import { Button, ChoiceCard, ChoiceGrid, Dialog, Steps } from "@/components/ui";
import { queryClient, sqk } from "@/lib/queries";
import { useT } from "@/i18n";
import { DirectConnect } from "./add/DirectConnect";
import { InstallStep } from "./add/InstallStep";
import { VibeConnect } from "./add/VibeConnect";
import type { InstallOs } from "./install";
import { connectAgents } from "./RemoteBridge";
import { loadAgents, useRemote } from "./store";
import type { AgentVia, RemoteAgent } from "./types";

export function AddRemoteDialog() {
  const t = useT();
  const open = useRemote((s) => s.addOpen);
  const [step, setStep] = useState(0);
  const [os, setOs] = useState<InstallOs>("linux");
  const [via, setVia] = useState<AgentVia>("direct");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RemoteAgent | null>(null);

  const close = () => {
    useRemote.setState({ addOpen: false });
    setTimeout(() => (setStep(0), setDone(null)), 200);
  };

  const finish = async (a: RemoteAgent) => {
    setDone(a);
    setStep(2);
    const list = await loadAgents(a.via === "vibe");
    const fresh = list.find((x) => x.key === a.key);
    if (fresh) await connectAgents([fresh]);
    void queryClient.invalidateQueries({ queryKey: sqk.servers });
  };

  const footer =
    step === 0 ? (
      <>
        <span className="mr-auto text-[12.5px] text-dim">{t("rmt.install.have")}</span>
        <Button variant="primary" onClick={() => setStep(1)}>
          {t("rmt.next")}
        </Button>
      </>
    ) : step === 1 ? (
      <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => setStep(0)}>
        {t("common.back")}
      </Button>
    ) : (
      <Button
        variant="primary"
        onClick={() => {
          close();
          void import("@/app/router").then((m) => m.router.navigate({ to: "/servers" }));
        }}
      >
        {t("rmt.done.go")}
      </Button>
    );

  return (
    <Dialog open={open} protect onOpenChange={(o) => !o && close()} locked={busy} size="lg" title={t("rmt.wiz.title")} description={t("rmt.wiz.desc")} footer={footer}>
      <div className="flex min-h-[380px] flex-col gap-5">
        <Steps steps={[t("rmt.step.install"), t("rmt.step.connect"), t("rmt.step.done")]} current={step} />
        {step === 0 && <InstallStep os={os} onOs={setOs} />}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <ChoiceGrid>
              <ChoiceCard icon={<Network size={18} />} title={t("rmt.via.direct")} text={t("rmt.via.direct.text")} selected={via === "direct"} onClick={() => setVia("direct")} />
              <ChoiceCard icon={<Cloud size={18} />} title={t("rmt.via.vibe")} text={t("rmt.via.vibe.text")} selected={via === "vibe"} onClick={() => setVia("vibe")} />
            </ChoiceGrid>
            {via === "direct" ? <DirectConnect onDone={finish} onBusy={setBusy} /> : <VibeConnect os={os} onDone={finish} />}
          </div>
        )}
        {step === 2 && done && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
            <CheckCircle2 size={44} strokeWidth={1.6} className="text-ok" />
            <div className="text-[17px] font-semibold text-text">{t("rmt.done.title", { name: done.name })}</div>
            <p className="max-w-[460px] text-[13.5px] leading-relaxed text-muted">{t("rmt.done.text")}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
