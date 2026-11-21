import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AccountApi } from "@/api/gateway";
import type { GatewayAgent } from "@/api/types";
import { useT } from "@/i18n";
import { Button, CopyField, Dialog, Field, Input, Notice, Segmented } from "@/components/ui";
import { formatCode } from "@/features/auth/AuthLayout";
import { INSTALL_COMMANDS, type InstallOs } from "./install";

export function AddAgentDialog({ open, onClose, account, onAdded }: { open: boolean; onClose: () => void; account: AccountApi; onAdded: (a: GatewayAgent) => void }) {
  const t = useT();
  const [os, setOs] = useState<InstallOs>("linux");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const claim = useMutation({
    mutationFn: () => account.claim(code, name || undefined),
    onSuccess: (a) => {
      onAdded(a);
      setCode("");
      setName("");
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t("addagent.title")}
      desc={t("addagent.desc")}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={claim.isPending} disabled={code.replace("-", "").length !== 8} onClick={() => claim.mutate()}>
            {t("addagent.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <span className="grid size-6 place-items-center rounded-full bg-brand text-[12px] text-[var(--ui-on-accent)]">1</span>
            {t("addagent.step1")}
          </h3>
          <Segmented
            value={os}
            onChange={setOs}
            items={[
              { key: "linux", label: "Linux" },
              { key: "windows", label: "Windows" },
              { key: "docker", label: "Docker" },
            ]}
          />
          <CopyField value={INSTALL_COMMANDS[os]} />
          <p className="text-meta text-muted">{t(`addagent.hint.${os}`)}</p>
        </section>
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 font-semibold">
            <span className="grid size-6 place-items-center rounded-full bg-brand text-[12px] text-[var(--ui-on-accent)]">2</span>
            {t("addagent.step2")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("addagent.code")} hint={t("addagent.code_hint")}>
              <Input placeholder="K7Q2-M9XD" value={code} onChange={(e) => setCode(formatCode(e.target.value))} className="h-11 font-mono text-[17px] font-semibold tracking-[0.15em]" />
            </Field>
            <Field label={t("addagent.name")} hint={t("addagent.name_hint")}>
              <Input placeholder={t("addagent.name_ph")} value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
            </Field>
          </div>
          {claim.error && <Notice tone="danger">{(claim.error as Error).message}</Notice>}
        </section>
      </div>
    </Dialog>
  );
}
