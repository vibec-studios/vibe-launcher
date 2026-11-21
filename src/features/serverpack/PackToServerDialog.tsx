import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CheckCircle2, Upload } from "lucide-react";
import { Button, Dialog, Progress, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { queryClient, sqk, useJavaInstances, useTask } from "@/lib/queries";
import { StepBar } from "@/features/servers/new/StepBar";
import { useServerTargets, useTargetRunning } from "@/features/installtarget/hooks";
import { parseServerTargetKey, serverTargetKey, useTargetRegistry } from "@/features/installtarget/registry";
import { packApi, pqk, type PackInput, type PackOptions } from "./api";
import { NO_WORLD, ReviewStep } from "./Review";
import { SourceStep, TargetStep, type SourceKind, type TargetKind } from "./steps";
import { closePackToServer, usePackDialog, type PackDialogRequest } from "./store";

export function PackToServerHost() {
  const req = usePackDialog((s) => s.req);
  const seq = usePackDialog((s) => s.seq);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(!!req), [req, seq]);
  if (!req) return null;
  return (
    <PackToServerDialog
      key={seq}
      req={req}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTimeout(() => usePackDialog.getState().seq === seq && closePackToServer(), 200);
      }}
    />
  );
}

type Phase = { k: "edit" } | { k: "busy"; label: string } | { k: "task"; taskId: string; serverId: string; remote: boolean } | { k: "done"; serverId: string | null; remote: boolean };

function PackToServerDialog({ req, open, onOpenChange }: { req: PackDialogRequest; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const { data: instances = [] } = useJavaInstances();
  const { targets } = useServerTargets();
  const servers = targets;
  const preset = parseServerTargetKey(req.serverKey);

  const [step, setStep] = useState(req.input ? 1 : 0);
  const [srcKind, setSrcKind] = useState<SourceKind>(req.input?.kind ?? "instance");
  const [instanceId, setInstanceId] = useState<string | null>(req.input?.kind === "instance" ? req.input.id : null);
  const [file, setFile] = useState<string | null>(req.input?.kind === "file" ? req.input.path : null);
  const [tgtKind, setTgtKind] = useState<TargetKind>(preset ? "existing" : "new");
  const [serverKey, setServerKey] = useState<string | null>(preset ? serverTargetKey(preset) : null);
  const [name, setName] = useState("");
  const [where, setWhere] = useState("local");
  const [nameTouched, setNameTouched] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState(true);
  const [world, setWorld] = useState(NO_WORLD);
  const [phase, setPhase] = useState<Phase>({ k: "edit" });

  useEffect(() => {
    if (!instanceId && srcKind === "instance") {
      const first = instances.find((i) => i.loader.kind !== "vanilla");
      if (first) setInstanceId(first.id);
    }
  }, [instances, instanceId, srcKind]);

  const input: PackInput | null = srcKind === "instance" ? (instanceId ? { kind: "instance", id: instanceId } : null) : file ? { kind: "file", path: file } : null;
  const target = useMemo(() => (tgtKind === "existing" && serverKey ? (servers.find((s) => s.key === serverKey) ?? null) : null), [tgtKind, serverKey, servers]);
  const localId = target?.origin === "local" ? target.id : null;
  const running = useTargetRunning(target);
  const preview = useQuery({
    queryKey: pqk.preview(input, localId),
    queryFn: () => packApi.preview(input!, localId),
    enabled: !!input && step >= 1,
    staleTime: 0,
    retry: 0,
  });

  useEffect(() => {
    const p = preview.data;
    if (!p) return;
    setSelected(new Set(p.entries.filter((e) => e.include).map((e) => e.path)));
    setConfigs(p.config_files > 0);
    if (!nameTouched) setName(`${p.name} Server`.slice(0, 60));
  }, [preview.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const task = useTask(phase.k === "task" ? phase.taskId : null);
  useEffect(() => {
    if (phase.k !== "task" || !task) return;
    if (task.status === "done") {
      setPhase({ k: "done", serverId: phase.serverId, remote: phase.remote });
      void queryClient.invalidateQueries({ queryKey: sqk.servers });
      void queryClient.invalidateQueries({ queryKey: pqk.status(phase.serverId) });
    }
    if (task.status === "failed" || task.status === "cancelled") {
      toast.error(task.error ?? tt("sp.failed"), tt("sp.failed"));
      setPhase({ k: "edit" });
    }
  }, [task, phase]);

  const steps = [t("sp.step.source"), t("sp.step.target"), t("sp.step.review")];
  const canNext = step === 0 ? !!input : step === 1 ? (tgtKind === "new" ? !!name.trim() : !!target) : !!preview.data && !(tgtKind === "existing" && running);
  const options: PackOptions = { selected: [...selected], configs, world: world === NO_WORLD ? null : world };
  const agents = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of servers) if (s.origin === "remote" && s.agentId) m.set(s.agentId, s.agentName ?? s.agentId);
    return [...m.entries()].map(([id, label]) => ({ id, label }));
  }, [servers]);
  const remoteProvider = useTargetRegistry((s) => s.providers.remote);
  const newRemote = tgtKind === "new" && where !== "local";
  const remoteNoUpload = (target?.origin === "remote" || newRemote) && !remoteProvider?.uploadPack;

  const run = async () => {
    if (!input) return;
    try {
      const agentId = newRemote ? where : target?.origin === "remote" ? target.agentId : null;
      if (agentId) {
        if (!remoteProvider?.uploadPack) throw new Error(tt("sp.remote_unsupported"));
        setPhase({ k: "busy", label: tt("sp.bundling") });
        const b = await packApi.bundle(input, options);
        setPhase({ k: "busy", label: tt("sp.uploading", { size: Math.max(1, Math.round(b.size / 1048576)) }) });
        const r = await remoteProvider.uploadPack(agentId, b.path, { name: newRemote ? name.trim() : target!.name, serverId: newRemote ? null : target!.id, format: "mrpack" });
        setPhase({ k: "done", serverId: r.server_id, remote: true });
        return;
      }
      setPhase({ k: "busy", label: tt("sp.starting") });
      const r = await packApi.apply(input, tgtKind === "new" ? { kind: "new", name: name.trim() } : { kind: "existing", id: target!.id }, options);
      setPhase({ k: "task", taskId: r.task_id, serverId: r.server_id, remote: false });
    } catch (e) {
      toast.error(errorMessage(e), tt("sp.failed"));
      setPhase({ k: "edit" });
    }
  };

  const busy = phase.k === "busy" || phase.k === "task";
  const footer =
    phase.k === "done" ? (
      <>
        <Button variant="subtle" onClick={() => onOpenChange(false)}>
          {t("common.close")}
        </Button>
        {phase.serverId && !phase.remote && (
          <Button
            variant="primary"
            onClick={() => {
              onOpenChange(false);
              nav({ to: "/servers/$id", params: { id: phase.serverId! }, search: { tab: "addons" } });
            }}
          >
            {t("sp.to_server")}
          </Button>
        )}
      </>
    ) : (
      <>
        {step > 0 && (
          <Button variant="ghost" icon={<ArrowLeft size={14} />} disabled={busy} onClick={() => setStep(step - 1)}>
            {t("common.back")}
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="subtle" disabled={busy} onClick={() => onOpenChange(false)}>
          {t("common.cancel")}
        </Button>
        {step < 2 ? (
          <Button variant="primary" icon={<ArrowRight size={14} />} disabled={!canNext} onClick={() => setStep(step + 1)}>
            {t("sp.next")}
          </Button>
        ) : (
          <Button variant="primary" icon={<Upload size={14} />} disabled={!canNext || remoteNoUpload} loading={busy} onClick={() => void run()}>
            {tgtKind === "new" ? t("sp.create") : t("sp.apply")}
          </Button>
        )}
      </>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("sp.title")} description={t("sp.description")} size="lg" locked={busy} footer={footer}>
      {phase.k === "done" ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="pack-done">
          <CheckCircle2 size={40} className="text-ok" />
          <div className="text-[16px] font-semibold text-text">{t("sp.done.title")}</div>
          <p className="max-w-[460px] text-[13px] text-muted">{phase.remote ? t("sp.done.remote") : t("sp.done.text")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <StepBar steps={steps} current={step} onJump={busy ? undefined : setStep} />
          {step === 0 && <SourceStep kind={srcKind} setKind={setSrcKind} instances={instances} instanceId={instanceId} setInstanceId={setInstanceId} file={file} setFile={setFile} />}
          {step === 1 && (
            <TargetStep
              kind={tgtKind}
              setKind={setTgtKind}
              servers={servers}
              serverKey={serverKey}
              setServerKey={setServerKey}
              agents={agents}
              where={where}
              setWhere={setWhere}
              name={name}
              setName={(n) => {
                setNameTouched(true);
                setName(n);
              }}
            />
          )}
          {step === 2 && (
            <ReviewStep
              preview={preview.data}
              error={preview.isError ? preview.error : null}
              retry={() => preview.refetch()}
              target={target}
              running={tgtKind === "existing" && running}
              isNew={tgtKind === "new"}
              selected={selected}
              setSelected={setSelected}
              configs={configs}
              setConfigs={setConfigs}
              world={world}
              setWorld={setWorld}
            />
          )}
          {remoteNoUpload && step === 2 && <p className="text-[12.5px] text-warn">{t("sp.remote_unsupported")}</p>}
          {(phase.k === "busy" || phase.k === "task") && (
            <div className="flex flex-col gap-1.5 rounded-card bg-surface px-4 py-3">
              <div className="flex items-center justify-between text-[12.5px] text-muted">
                <span className="truncate">{phase.k === "busy" ? phase.label : (task?.message ?? task?.title ?? t("sp.starting"))}</span>
                <span className="tabular-nums">{task?.progress != null ? `${Math.round(task.progress * 100)} %` : ""}</span>
              </div>
              <Progress value={task?.progress ?? null} />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
