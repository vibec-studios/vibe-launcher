import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpCircle, Check, Download, Package } from "lucide-react";
import { Button, Spinner, Tooltip, confirm, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { useT, t as tt } from "@/i18n";
import { formatLoader, instanceAccent } from "@/lib/format";
import { platformNames, type AddonSource } from "@/features/servers/addonsApi";
import { providerOf, refreshTarget, tqk, useTargetRunning } from "@/features/installtarget/hooks";
import type { AddonCheck, ServerTargetInfo } from "@/features/installtarget/types";

export function TargetIcon({ target, size = 24 }: { target: ServerTargetInfo; size?: number }) {
  return <InstanceIcon icon={target.icon} accent={instanceAccent(target.origin === "local" ? target.id : target.key, target.accent)} size={size} />;
}

export function softwareLabel(t: Pick<ServerTargetInfo, "platform" | "loader">): string {
  return t.platform ? platformNames[t.platform.kind] : formatLoader(t.loader);
}

export function AddonIcon({ src, size = 36 }: { src: string | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="grid shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface3 text-dim" style={{ width: size, height: size }}>
      {src && !broken ? <img src={src} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} /> : <Package size={size * 0.5} />}
    </div>
  );
}

export function checkText(c: AddonCheck, t: ServerTargetInfo): string {
  switch (c.reason) {
    case "vanilla":
      return tt("st.reason.vanilla");
    case "hangar":
      return tt("st.reason.hangar", { software: softwareLabel(t) });
    case "client_only":
      return tt("st.reason.client_only");
    case "not_plugin":
      return tt("st.reason.not_plugin", { software: softwareLabel(t) });
    case "loader":
      return tt("st.reason.loader", { software: softwareLabel(t) });
    case "version":
      return tt("st.reason.version", { mc: t.mc_version });
    case "external":
      return c.message ?? tt("st.reason.external");
    default:
      return "";
  }
}

export function useServerInstall(target: ServerTargetInfo | null) {
  const [busy, setBusy] = useState<string | null>(null);
  const running = useTargetRunning(target);
  const install = async (source: AddonSource, id: string, title: string) => {
    if (!target) return null;
    setBusy(`${source}:${id}`);
    try {
      const files = await providerOf(target).install(target, source, id);
      const msg = files.length > 1 ? tt("st.installed_deps", { name: title, server: target.name, n: files.length - 1 }) : tt("st.installed", { name: title, server: target.name });
      toast.success(msg, running ? tt("srv.addons.restart_hint") : undefined);
      return files;
    } catch (e) {
      toast.error(e, tt("srv.addons.install_failed"));
      return null;
    } finally {
      setBusy(null);
      refreshTarget(target);
    }
  };
  const update = async (file: string, title: string) => {
    if (!target) return;
    setBusy(`update:${file}`);
    try {
      await providerOf(target).update(target, [file]);
      toast.success(tt("st.updated", { name: title }), running ? tt("srv.addons.restart_hint") : undefined);
    } catch (e) {
      toast.error(e, tt("srv.addons.update_failed"));
    } finally {
      setBusy(null);
      refreshTarget(target);
    }
  };
  return { busy, install, update };
}

export function useTargetAddons(target: ServerTargetInfo | null, enabled = true) {
  const addons = useQuery({
    queryKey: target ? tqk.addons(target) : ["target-addons", "none"],
    queryFn: () => providerOf(target!).addons(target!),
    enabled: !!target && enabled,
    staleTime: 15_000,
  });
  const updates = useQuery({
    queryKey: target ? tqk.updates(target) : ["target-addon-updates", "none"],
    queryFn: () => providerOf(target!).updates(target!),
    enabled: !!target && enabled && !!addons.data?.items.length,
    staleTime: 10 * 60_000,
  });
  return { addons, updates };
}

export function ServerInstallButton({
  target,
  source,
  project,
  title,
  wide,
}: {
  target: ServerTargetInfo;
  source: AddonSource;
  project: string;
  title: string;
  wide?: boolean;
}) {
  const t = useT();
  const check = useQuery({
    queryKey: tqk.check(target, source, project),
    queryFn: () => providerOf(target).check(target, source, project),
    staleTime: 60_000,
    retry: 0,
  });
  const { addons, updates } = useTargetAddons(target);
  const { busy, install, update } = useServerInstall(target);
  const item = addons.data?.items.find((a) => a.project_id === project || a.slug === project || (!!title && (a.title ?? a.name ?? "").toLowerCase() === title.toLowerCase()));
  const up = item ? updates.data?.find((u) => u.file_name === item.file_name) : undefined;
  const size = wide ? "md" : "sm";
  const iconSize = wide ? 15 : 13;

  if (check.isPending) {
    return (
      <Button size={size} variant="ghost" disabled icon={<Spinner size={12} />}>
        {t("st.checking")}
      </Button>
    );
  }
  if (up && item) {
    return (
      <Button size={size} variant="accent" icon={<ArrowUpCircle size={iconSize} />} loading={busy === `update:${item.file_name}`} onClick={() => update(item.file_name, title)}>
        {t("st.update_to", { v: up.latest })}
      </Button>
    );
  }
  if (item || check.data?.installed) {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 rounded-ctl bg-ok/12 px-3.5 text-[13.5px] font-semibold text-ok">
        <Check size={15} strokeWidth={2.5} />
        {t("st.installed_on", { server: target.name })}
      </span>
    );
  }
  const c = check.data;
  const blocked = !!c && !c.ok && c.reason !== "client_only";
  const warn = !!c && !c.ok && c.reason === "client_only";
  const label = wide ? t("st.install_on", { server: target.name }) : t("common.install");
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Tooltip content={c && !c.ok ? <span className="block max-w-[260px] leading-snug">{checkText(c, target)}</span> : c?.version ? t("st.version_hint", { v: c.version }) : null}>
        <span>
          <Button
            size={size}
            variant={blocked || warn ? "ghost" : wide ? "primary" : "accent"}
            icon={blocked || warn ? <AlertTriangle size={iconSize} /> : <Download size={iconSize} />}
            disabled={blocked}
            loading={busy === `${source}:${project}`}
            onClick={async () => {
              if (warn) {
                const ok = await confirm({ title: t("st.force.title", { name: title }), text: checkText(c!, target), confirmLabel: t("st.force.confirm") });
                if (!ok) return;
              }
              await install(source, project, title);
            }}
          >
            {label}
          </Button>
        </span>
      </Tooltip>
      {c && !c.ok && wide && <span className="max-w-[320px] text-[12px] leading-snug text-warn">{checkText(c, target)}</span>}
      {check.isError && <span className="text-[12px] text-dim">{t("st.check_failed")}</span>}
      {c?.ok && c.deps > 0 && wide && <span className="text-[12px] text-dim">{t("st.deps_hint", { n: c.deps })}</span>}
    </div>
  );
}
