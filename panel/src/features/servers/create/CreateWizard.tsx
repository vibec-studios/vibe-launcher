import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import type { LoaderKind, PlatformKind, ServerCreate, Software } from "@/api/types";
import { useAgent, useTask } from "@/app/agent";
import { mib } from "@/app/format";
import { navigate } from "@/app/router";
import { useT } from "@/i18n";
import { Button, Dialog, Notice, cn } from "@/components/ui";
import { TaskProgress } from "@/components/TaskProgress";
import { SOFTWARE_NAMES } from "../meta";
import { SoftwareIcon } from "../parts";
import { SoftwareStep } from "./SoftwareStep";
import { VersionStep } from "./VersionStep";
import { ResourcesStep, recommendedMemory } from "./ResourcesStep";

const PLATFORMS: Software[] = ["paper", "purpur", "folia"];

function StepBar({ step, labels }: { step: number; labels: string[] }) {
  return (
    <ol className="mb-5 flex gap-2">
      {labels.map((l, i) => (
        <li key={l} className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={cn("h-1 rounded-pill", i <= step ? "bg-brand" : "bg-white/[.1]")} />
          <span className={cn("truncate text-caption font-semibold", i === step ? "text-text" : "text-dim")}>{l}</span>
        </li>
      ))}
    </ol>
  );
}

export function CreateWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { api, base } = useAgent();
  const [step, setStep] = useState(0);
  const [software, setSoftware] = useState<Software>("paper");
  const [mc, setMc] = useState("");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [name, setName] = useState("");
  const [memory, setMemory] = useState(recommendedMemory("paper"));
  const [port, setPort] = useState("");
  const create = useMutation({
    mutationFn: () => {
      const platform = PLATFORMS.includes(software);
      const req: ServerCreate = {
        name: name.trim() || t("create.name_ph"),
        mc_version: mc,
        loader: { kind: platform ? "vanilla" : (software as LoaderKind), version: loaderVersion || null },
        platform: platform ? { kind: software as PlatformKind, build: null } : null,
        memory_mb: memory,
        port: port ? Number(port) : null,
      };
      return api.createServer(req);
    },
  });
  const task = useTask(create.data?.task_id ?? null);
  const pickSoftware = useCallback((s: Software) => {
    setSoftware(s);
    setMemory(recommendedMemory(s));
  }, []);
  const close = () => {
    onClose();
    setTimeout(() => {
      setStep(0);
      create.reset();
    }, 200);
  };
  const labels = [t("create.step.software"), t("create.step.version"), t("create.step.details"), t("create.step.done")];
  const done = task?.status === "done";
  const openServer = () => {
    if (create.data) navigate(`${base}/servers/${encodeURIComponent(create.data.server.id)}`);
    close();
  };
  const footer = create.data ? (
    <Button variant="primary" disabled={!done} onClick={openServer} icon={<ArrowRight size={16} />}>
      {t("create.open")}
    </Button>
  ) : (
    <>
      {step > 0 && (
        <Button variant="subtle" icon={<ArrowLeft size={16} />} onClick={() => setStep(step - 1)} className="mr-auto">
          {t("common.back")}
        </Button>
      )}
      <Button variant="subtle" onClick={close}>
        {t("common.cancel")}
      </Button>
      {step < 3 ? (
        <Button variant="primary" disabled={step === 1 && !mc} onClick={() => setStep(step + 1)} icon={<ArrowRight size={16} />}>
          {t("common.next")}
        </Button>
      ) : (
        <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()} icon={<Check size={16} />}>
          {t("create.submit")}
        </Button>
      )}
    </>
  );
  return (
    <Dialog open={open} onClose={close} size="lg" title={t("create.title")} desc={t("create.desc")} footer={footer}>
      <StepBar step={create.data ? 3 : step} labels={labels} />
      <div className="min-h-[340px]">
        {create.data ? (
          <div className="flex flex-col gap-4">
            <TaskProgress taskId={create.data.task_id} />
            {done ? <Notice tone="info" title={t("create.done_title")}>{t("create.done_desc")}</Notice> : <p className="text-meta text-muted">{t("create.installing_desc")}</p>}
          </div>
        ) : step === 0 ? (
          <SoftwareStep value={software} onChange={pickSoftware} />
        ) : step === 1 ? (
          <VersionStep software={software} mc={mc} onMc={setMc} loaderVersion={loaderVersion} onLoaderVersion={setLoaderVersion} />
        ) : step === 2 ? (
          <ResourcesStep software={software} name={name} onName={setName} memory={memory} onMemory={setMemory} port={port} onPort={setPort} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4 rounded-card bg-surface2 p-4">
              <SoftwareIcon software={software} />
              <div>
                <div className="text-[16px] font-semibold">{name.trim() || t("create.name_ph")}</div>
                <div className="text-meta text-muted">
                  {SOFTWARE_NAMES[software]} {mc} · {mib(memory)} RAM{port ? ` · Port ${port}` : ""}
                </div>
              </div>
            </div>
            <p className="text-[13.5px] text-muted">{t("create.summary_desc")}</p>
            {create.error && <Notice tone="danger">{(create.error as Error).message}</Notice>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
