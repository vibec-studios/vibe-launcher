// „Neuer Server“: Modus „Neu“ (Version + Loader wählen) oder „Aus Instanz“ (Version/Loader übernehmen,
// Mods mit Client/Server-Einordnung auswählen, Configs und optional eine Welt kopieren).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Info } from "lucide-react";
import { api } from "@/lib/api";
import { qk, sqk, useServers, useSystemInfo, useJavaInstances } from "@/lib/queries";
import type { Instance, ModSide, ServerCreate, ServerModCandidate } from "@/lib/types";
import { formatLoader, instanceAccent, loaderNames } from "@/lib/format";
import { Button, Checkbox, Dialog, ErrorState, Field, Input, NumberInput, Segmented, Select, Skeleton, Slider, Switch, Tag, Tooltip, cn, toast } from "@/components/ui";
import { VersionPicker, type VersionValue } from "@/components/instance/VersionPicker";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { formatMb } from "@/components/instance/forms";
import { useT } from "@/i18n";
import { PlatformPicker, type PlatformValue } from "./PlatformPicker";
import { platformNames } from "./addonsApi";

type Mode = "new" | "instance";
/** Mod-Loader/Vanilla oder Plugin-Software */
type Kind = "mods" | "plugins";
const DEFAULT_PORT = 25565;
const DEFAULT_RAM = 2048;
const NEW_WORLD = "__new__";

function suggestPluginName(p: PlatformValue): string {
  return p.mc ? `${platformNames[p.kind]}-Server ${p.mc}` : "";
}

function suggestName(v: VersionValue): string {
  if (!v.mc) return "";
  return v.loader === "vanilla" ? `Server ${v.mc}` : `${loaderNames[v.loader]}-Server ${v.mc}`;
}

const sideColor: Record<ModSide, string> = { both: "var(--color-muted)", server: "var(--color-ok)", client: "var(--color-warn)", unknown: "var(--color-dim)" };

function RamPort({ ram, setRam, port, setPort, total }: { ram: number; setRam: (v: number) => void; port: number; setPort: (v: number) => void; total: number }) {
  const t = useT();
  const limit = Math.max(1024, Math.floor(total / 256) * 256);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="label">{t("srv.ram")}</span>
        <div className="flex h-10 items-center gap-3">
          <Slider value={ram} min={512} max={limit} step={256} onChange={setRam} />
          <span className="w-[64px] shrink-0 text-right font-mono text-[12px] text-muted">{formatMb(ram)}</span>
        </div>
      </div>
      <Field label={t("srv.port")}>
        <NumberInput value={port} min={1024} max={65535} onChange={(v) => v !== null && setPort(v)} aria-label={t("srv.port")} />
      </Field>
    </div>
  );
}

function ModList({
  mods,
  selected,
  setSelected,
}: {
  mods: ServerModCandidate[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
}) {
  const t = useT();
  const clientCount = mods.filter((m) => m.side === "client").length;
  const toggle = (f: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(f);
    else next.delete(f);
    setSelected(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="label flex-1">
          {t("srv.new.mods")} <span className="text-dim">{t("srv.new.mods_count", { n: selected.size, total: mods.length })}</span>
        </span>
        <button type="button" className="rounded-xs text-[12px] text-muted hover:text-text" onClick={() => setSelected(new Set(mods.filter((m) => m.server_ok).map((m) => m.file_name)))}>
          {t("srv.new.mods_suggested")}
        </button>
        <button type="button" className="rounded-xs text-[12px] text-muted hover:text-text" onClick={() => setSelected(new Set(mods.map((m) => m.file_name)))}>
          {t("common.all")}
        </button>
        <button type="button" className="rounded-xs text-[12px] text-muted hover:text-text" onClick={() => setSelected(new Set())}>
          {t("common.none")}
        </button>
      </div>
      {clientCount > 0 && (
        <div className="flex items-start gap-2 rounded-card bg-warn/[.08] px-3 py-2 text-[12px] text-warn">
          <Info size={13} className="mt-px shrink-0" />
          {t("srv.new.client_hint", { n: clientCount })}
        </div>
      )}
      <div className="scroll h-[236px] rounded-card bg-field">
        {mods.map((m) => {
          const on = selected.has(m.file_name);
          return (
            <label
              key={m.file_name}
              className={cn("flex h-9 cursor-pointer items-center gap-3 px-3 hover:bg-white/[.04]", !on && "opacity-70")}
            >
              <Checkbox checked={on} onChange={(v) => toggle(m.file_name, v)} label={m.name ?? m.file_name} />
              <div className="min-w-0 flex-1">
                <div className={cn("truncate text-[13px]", m.enabled ? "text-text" : "text-dim line-through")}>{m.name ?? m.file_name}</div>
              </div>
              <Tooltip content={t(`srv.side.${m.side}.hint`)}>
                <span>
                  <Tag color={sideColor[m.side]}>{t(`srv.side.${m.side}`)}</Tag>
                </span>
              </Tooltip>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function FromInstance({
  instance,
  mods,
  setMods,
  copyConfigs,
  setCopyConfigs,
  world,
  setWorld,
}: {
  instance: Instance;
  mods: Set<string>;
  setMods: (s: Set<string>) => void;
  copyConfigs: boolean;
  setCopyConfigs: (v: boolean) => void;
  world: string;
  setWorld: (v: string) => void;
}) {
  const t = useT();
  const vanilla = instance.loader.kind === "vanilla";
  const cands = useQuery({
    queryKey: sqk.modCandidates(instance.id),
    queryFn: () => api.serverModCandidates(instance.id),
    enabled: !vanilla,
    staleTime: 30_000,
    placeholderData: undefined,
  });
  const worlds = useQuery({ queryKey: qk.worlds(instance.id), queryFn: () => api.worldsList(instance.id), staleTime: 30_000, placeholderData: undefined });

  // Vorschlag übernehmen, sobald die Liste da ist (Komponente wird je Instanz neu gemountet)
  useEffect(() => {
    setMods(new Set((cands.data ?? []).filter((m) => m.server_ok).map((m) => m.file_name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cands.data]);
  useEffect(() => setWorld(NEW_WORLD), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-5">
      {!vanilla &&
        (cands.isError ? (
          <ErrorState error={cands.error} onRetry={() => cands.refetch()} className="py-6" />
        ) : !cands.data ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-[236px]" />
          </div>
        ) : cands.data.length === 0 ? (
          <p className="text-[13px] text-dim">{t("srv.new.no_mods")}</p>
        ) : (
          <ModList mods={cands.data} selected={mods} setSelected={setMods} />
        ))}
      <div className="grid grid-cols-2 gap-5">
        <Field label={t("srv.new.world")} hint={t("srv.new.world.hint")}>
          <Select
            value={world}
            onChange={setWorld}
            options={[{ value: NEW_WORLD, label: t("srv.new.world.new") }, ...(worlds.data ?? []).map((w) => ({ value: w.folder, label: w.name, hint: w.game_mode ?? undefined }))]}
          />
        </Field>
        {!vanilla && (
          <div className="flex flex-col gap-1.5">
            <span className="label">{t("srv.new.configs")}</span>
            <label className="flex h-10 cursor-pointer items-center gap-3 text-[13px] text-text">
              <Switch checked={copyConfigs} onChange={setCopyConfigs} label={t("srv.new.configs")} />
              {t("srv.new.configs.text")}
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

export function NewServerDialog({ open, fromInstance, onOpenChange }: { open: boolean; fromInstance: string | null; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const { data: instances = [] } = useJavaInstances();
  const { data: servers = [] } = useServers();
  const { data: sys } = useSystemInfo();
  const total = sys?.total_memory_mb ?? 8192;

  const [mode, setMode] = useState<Mode>("new");
  const [ver, setVer] = useState<VersionValue>({ mc: null, loader: "fabric", loaderVersion: null });
  const [kind, setKind] = useState<Kind>("mods");
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

  const inst = useMemo(() => instances.find((i) => i.id === instId) ?? null, [instances, instId]);

  // Beim Öffnen zurücksetzen
  useEffect(() => {
    if (!open) return;
    setMode(fromInstance ? "instance" : "new");
    setInstId(fromInstance ?? instances[0]?.id ?? null);
    setNameTouched(false);
    setRam(DEFAULT_RAM);
    // Ersten Port wählen, den noch kein anderer Server benutzt
    const used = new Set(servers.map((s) => s.port));
    let p = DEFAULT_PORT;
    while (used.has(p)) p++;
    setPort(p);
    setMods(new Set());
    setCopyConfigs(true);
    setWorld(NEW_WORLD);
    setBusy(false);
  }, [open, fromInstance]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (nameTouched) return;
    if (mode === "instance") setName(inst ? t("srv.new.name_from", { name: inst.name }) : "");
    else if (kind === "plugins") setName(suggestPluginName(plat));
    else setName(suggestName(ver));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, kind, inst?.id, ver.mc, ver.loader, plat.kind, plat.mc, nameTouched]);

  const needsLoaderVersion = ver.loader !== "vanilla";
  const valid =
    name.trim().length > 0 &&
    (mode === "instance"
      ? !!inst && !!inst.mc_version
      : kind === "plugins"
        ? !!plat.mc && !!plat.build
        : !!ver.mc && (!needsLoaderVersion || !!ver.loaderVersion));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const req: ServerCreate =
      mode === "instance" && inst
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
              loader: { kind: ver.loader, version: needsLoaderVersion ? ver.loaderVersion : null },
              port,
              memory_mb: ram,
            };
    try {
      const res = await api.serverCreate(req);
      onOpenChange(false);
      nav({ to: "/servers/$id", params: { id: res.server.id }, search: { tab: "console" } });
    } catch (e) {
      toast.error(e, t("srv.new.failed"));
      setBusy(false);
    }
  };

  const nameField = (
    <Field label={t("srv.name")}>
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
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("srv.new.title")}
      description={t("srv.new.desc")}
      size="lg"
      locked={busy}
      footer={
        <>
          <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid} loading={busy}>
            {t("srv.new.create")}
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-5"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox") {
            e.preventDefault();
            submit();
          }
        }}
      >
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          items={[
            { value: "new", label: t("srv.new.mode.new") },
            { value: "instance", label: t("srv.new.mode.instance"), disabled: instances.length === 0 },
          ]}
          className="w-full [&>button]:flex-1"
        />

        {mode === "new" && (
          <Segmented<Kind>
            value={kind}
            onChange={setKind}
            items={[
              { value: "mods", label: t("srv.new.kind.mods") },
              { value: "plugins", label: t("srv.new.kind.plugins") },
            ]}
            className="w-full [&>button]:flex-1"
          />
        )}

        {mode === "new" && kind === "plugins" ? (
          <PlatformPicker
            value={plat}
            onChange={setPlat}
            listHeight={262}
            render={({ platform, list, build, hint }) => (
              <>
                {platform}
                <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-7">
                  {list}
                  <div className="flex flex-col gap-5">
                    {nameField}
                    {build}
                    <RamPort ram={ram} setRam={setRam} port={port} setPort={setPort} total={total} />
                    <div className="flex items-start gap-2 text-dim">
                      <Info size={13} className="mt-0.5 shrink-0" />
                      {hint}
                    </div>
                  </div>
                </div>
              </>
            )}
          />
        ) : mode === "new" ? (
          <VersionPicker
            value={ver}
            onChange={setVer}
            listHeight={262}
            render={({ loader, list, loaderVersion }) => (
              <>
                {loader}
                <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-7">
                  {list}
                  <div className="flex flex-col gap-5">
                    {nameField}
                    {loaderVersion}
                    <RamPort ram={ram} setRam={setRam} port={port} setPort={setPort} total={total} />
                    <p className="flex items-start gap-2 text-[12px] text-dim">
                      <Info size={13} className="mt-px shrink-0" />
                      {t("srv.new.hint")}
                    </p>
                  </div>
                </div>
              </>
            )}
          />
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-7">
              <Field label={t("srv.new.instance")}>
                <Select
                  value={instId}
                  onChange={setInstId}
                  options={instances.map((i) => ({ value: i.id, label: i.name, hint: `${loaderNames[i.loader.kind]} ${i.mc_version}` }))}
                />
              </Field>
              {nameField}
            </div>
            {inst && (
              <div className="flex items-center gap-3 rounded-card bg-surface px-3 py-2.5">
                <InstanceIcon icon={inst.icon} accent={instanceAccent(inst.id, inst.accent)} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-text">{inst.name}</div>
                  <div className="text-[12px] text-muted">
                    {formatLoader(inst.loader)} · Minecraft {inst.mc_version}
                  </div>
                </div>
                {!inst.mc_version && (
                  <span className="flex items-center gap-1.5 text-[12px] text-warn">
                    <AlertTriangle size={13} />
                    {t("srv.new.no_version")}
                  </span>
                )}
              </div>
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
            <RamPort ram={ram} setRam={setRam} port={port} setPort={setPort} total={total} />
          </>
        )}
      </div>
    </Dialog>
  );
}
