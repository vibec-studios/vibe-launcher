// „Neuer Server“ als Assistent: 1. Art (aus Instanz, Vanilla, Mods, Plugins) · 2. Version bzw. Instanz · 3. Name & Leistung.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, ArrowRight, Info } from "lucide-react";
import { api } from "@/lib/api";
import { useServers, useSystemInfo, useJavaInstances } from "@/lib/queries";
import type { LoaderKind, ServerCreate } from "@/lib/types";
import { formatLoader, loaderNames } from "@/lib/format";
import { Button, Dialog, Field, Input, Select, toast } from "@/components/ui";
import type { VersionValue } from "@/components/instance/VersionPicker";
import { useT } from "@/i18n";
import type { PlatformValue } from "./PlatformPicker";
import { platformNames } from "./addonsApi";
import { StepBar } from "./new/StepBar";
import { FromInstance, NEW_WORLD } from "./new/FromInstance";
import { AdvancedPort, RamField } from "./new/Resources";
import { KindStep } from "./new/KindStep";
import { PluginStep } from "./new/PluginStep";
import { SummaryCard } from "./new/SummaryCard";
import { VersionStep } from "./new/VersionStep";
import { DEFAULT_PORT, DEFAULT_RAM, suggestName, suggestPluginName, type Kind } from "./new/utils";
import { TargetField } from "@/features/remote/TargetField";
import { remoteServerCreate } from "@/features/remote/dispatch";

export function NewServerDialog({ open, fromInstance, onOpenChange }: { open: boolean; fromInstance: string | null; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const { data: instances = [] } = useJavaInstances();
  const { data: servers = [] } = useServers();
  const { data: sys } = useSystemInfo();
  const total = sys?.total_memory_mb ?? 8192;

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind>("vanilla");
  const [ver, setVer] = useState<VersionValue>({ mc: null, loader: "vanilla", loaderVersion: null });
  const [modLoader, setModLoader] = useState<Exclude<LoaderKind, "vanilla">>("fabric");
  const [plat, setPlat] = useState<PlatformValue>({ kind: "paper", mc: null, build: null });
  const [instId, setInstId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [ram, setRam] = useState(DEFAULT_RAM);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [mods, setMods] = useState<Set<string>>(new Set());
  const [copyConfigs, setCopyConfigs] = useState(true);
  const [world, setWorld] = useState(NEW_WORLD);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("local");

  const inst = useMemo(() => instances.find((i) => i.id === instId) ?? null, [instances, instId]);

  useEffect(() => {
    if (!open) return;
    setKind(fromInstance ? "instance" : "vanilla");
    setStep(fromInstance ? 1 : 0);
    setInstId(fromInstance ?? instances[0]?.id ?? null);
    setVer({ mc: null, loader: "vanilla", loaderVersion: null });
    setNameTouched(false);
    setRam(DEFAULT_RAM);
    const used = new Set(servers.map((s) => s.port));
    let p = DEFAULT_PORT;
    while (used.has(p)) p++;
    setPort(p);
    setMods(new Set());
    setCopyConfigs(true);
    setWorld(NEW_WORLD);
    setBusy(false);
  }, [open, fromInstance]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickKind = (k: Kind) => {
    setKind(k);
    if (k === "vanilla") setVer((v) => ({ ...v, loader: "vanilla", loaderVersion: null }));
    if (k === "mods") setVer((v) => ({ ...v, loader: modLoader, loaderVersion: null }));
  };
  const pickLoader = (l: Exclude<LoaderKind, "vanilla">) => {
    setModLoader(l);
    setVer((v) => (v.loader === l ? v : { ...v, loader: l, loaderVersion: null }));
  };

  useEffect(() => {
    if (nameTouched) return;
    if (kind === "instance") setName(inst ? t("srv.new.name_from", { name: inst.name }) : "");
    else if (kind === "plugins") setName(suggestPluginName(plat));
    else setName(suggestName(ver));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, inst?.id, ver.mc, ver.loader, plat.kind, plat.mc, nameTouched]);

  const versionOk =
    kind === "instance"
      ? !!inst && !!inst.mc_version
      : kind === "plugins"
        ? !!plat.mc && !!plat.build
        : !!ver.mc && (ver.loader === "vanilla" || !!ver.loaderVersion);
  const valid = versionOk && name.trim().length > 0;
  const stepOk = step === 0 ? kind !== "instance" || instances.length > 0 : step === 1 ? versionOk : valid;
  const last = step === 2;

  const summary =
    kind === "instance" && inst
      ? `${inst.name} · ${formatLoader(inst.loader)} · Minecraft ${inst.mc_version}`
      : kind === "plugins"
        ? `${platformNames[plat.kind]} · Minecraft ${plat.mc ?? "–"}`
        : `${ver.loader === "vanilla" ? "Vanilla" : `${loaderNames[ver.loader]} ${ver.loaderVersion ?? ""}`.trim()} · Minecraft ${ver.mc ?? "–"}`;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const req: ServerCreate =
      kind === "instance" && inst
        ? {
            name: name.trim(),
            mc_version: inst.mc_version,
            loader: inst.loader,
            from_instance: inst.id,
            mods: inst.loader.kind === "vanilla" ? [] : [...mods],
            copy_configs: inst.loader.kind !== "vanilla" && copyConfigs,
            world: world === NEW_WORLD ? null : world,
            port,
            memory_mb: ram,
          }
        : kind === "plugins"
          ? {
              name: name.trim(),
              mc_version: plat.mc!,
              loader: { kind: "vanilla", version: null },
              platform: { kind: plat.kind, build: plat.build },
              port,
              memory_mb: ram,
            }
          : {
              name: name.trim(),
              mc_version: ver.mc!,
              loader: { kind: ver.loader, version: ver.loader !== "vanilla" ? ver.loaderVersion : null },
              port,
              memory_mb: ram,
            };
    try {
      const res = target !== "local" && kind !== "instance" ? await remoteServerCreate(target, req) : await api.serverCreate(req);
      onOpenChange(false);
      nav({ to: "/servers/$id", params: { id: res.server.id }, search: { tab: "console" } });
    } catch (e) {
      toast.error(e, t("srv.new.failed"));
      setBusy(false);
    }
  };

  const next = () => {
    if (!stepOk || busy) return;
    if (last) void submit();
    else setStep((s) => s + 1);
  };

  const steps = [t("uic.srv.step.kind"), kind === "instance" ? t("uic.srv.step.instance") : t("uic.srv.step.version"), t("uic.srv.step.finish")];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("srv.new.title")}
      description={t("uic.srv.desc")}
      size="lg"
      locked={busy}
      footer={
        <>
          {step > 0 ? (
            <Button variant="subtle" icon={<ArrowLeft size={15} />} className="mr-auto" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              {t("common.back")}
            </Button>
          ) : (
            <span className="mr-auto" />
          )}
          <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={next} disabled={!stepOk} loading={busy}>
            {last ? t("srv.new.create") : t("uic.next")}
            {!last && <ArrowRight size={15} />}
          </Button>
        </>
      }
    >
      <div
        className="flex min-h-[400px] flex-col gap-5 pb-1"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox") {
            e.preventDefault();
            next();
          }
        }}
      >
        <StepBar steps={steps} current={step} onJump={busy ? undefined : setStep} />

        {step === 0 && <KindStep kind={kind} hasInstances={instances.length > 0} pickKind={pickKind} />}

        {step === 1 && kind === "plugins" && <PluginStep plat={plat} setPlat={setPlat} />}

        {step === 1 && (kind === "vanilla" || kind === "mods") && <VersionStep kind={kind} ver={ver} setVer={setVer} pickLoader={pickLoader} />}

        {step === 1 && kind === "instance" && (
          <div className="flex flex-col gap-5">
            <Field label={t("srv.new.instance")}>
              <Select
                value={instId}
                onChange={setInstId}
                options={instances.map((i) => ({ value: i.id, label: i.name, hint: `${loaderNames[i.loader.kind]} ${i.mc_version}` }))}
              />
            </Field>
            {inst && !inst.mc_version && (
              <p className="flex items-center gap-1.5 text-[12.5px] text-warn">
                <AlertTriangle size={13} />
                {t("srv.new.no_version")}
              </p>
            )}
            {inst && (
              <FromInstance
                key={inst.id}
                instance={inst}
                mods={mods}
                setMods={setMods}
                copyConfigs={copyConfigs}
                setCopyConfigs={setCopyConfigs}
                world={world}
                setWorld={setWorld}
              />
            )}
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-7 max-[700px]:grid-cols-1">
            <div className="flex flex-col gap-5">
              <Field label={t("srv.name")} hint={t("uic.srv.name.hint")}>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                  placeholder={t("srv.new.name_placeholder")}
                  maxLength={64}
                  autoFocus
                />
              </Field>
              <RamField ram={ram} setRam={setRam} total={total} />
              <TargetField value={target} onChange={setTarget} localOnly={kind === "instance"} />
            </div>
            <div className="flex flex-col gap-4">
              <SummaryCard kind={kind} inst={inst} name={name} summary={summary} />
              <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
                <Info size={14} className="mt-0.5 shrink-0" />
                {t("uic.srv.after")}
              </p>
              <AdvancedPort port={port} setPort={setPort} />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
