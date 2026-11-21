import { useState } from "react";
import { Check, Download } from "lucide-react";
import { Spinner, cn, confirm, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { useServerTargets, providerOf } from "@/features/installtarget/hooks";
import { addonSupport } from "@/features/installtarget/registry";
import type { ServerTargetInfo } from "@/features/installtarget/types";
import { TargetIcon, checkText, softwareLabel, useServerInstall } from "./parts";

const PLUGIN_LOADERS: Record<string, string[]> = {
  paper: ["paper", "spigot", "bukkit"],
  purpur: ["purpur", "paper", "spigot", "bukkit"],
  folia: ["folia"],
};

export interface PickerProject {
  source: string;
  id: string;
  title: string;
  project_type: string;
  loaders: string[];
  game_versions: string[];
}

export function quickServerCompat(p: Pick<PickerProject, "loaders" | "game_versions">, s: ServerTargetInfo): "ok" | "loader" | "version" {
  const loaders = s.platform ? PLUGIN_LOADERS[s.platform.kind] : s.loader.kind === "quilt" ? ["quilt", "fabric"] : [s.loader.kind];
  if (p.loaders.length && !p.loaders.some((l) => loaders.includes(l))) return "loader";
  if (p.game_versions.length && !p.game_versions.includes(s.mc_version)) return "version";
  return "ok";
}

export function serverEligible(p: Pick<PickerProject, "source" | "project_type">) {
  return p.source === "modrinth" && (p.project_type === "mod" || (p.project_type as string) === "plugin");
}

export function ServerPickerSection({ project, close, bare }: { project: PickerProject; close: () => void; bare?: boolean }) {
  const t = useT();
  const { targets } = useServerTargets();
  const servers = targets
    .filter((s) => addonSupport(s))
    .map((s) => ({ s, c: quickServerCompat(project, s) }))
    .sort((a, b) => Number(b.c === "ok") - Number(a.c === "ok"));
  if (!serverEligible(project) || servers.length === 0) return null;
  return (
    <>
      {!bare && <div className="-mx-1 my-1 h-px bg-line" />}
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-dim">{t("st.picker.title")}</div>
      <div className="scroll max-h-[min(200px,25vh)] shrink">
        {servers.map(({ s, c }) => (
          <ServerPickerRow key={s.key} target={s} project={project} compat={c} close={close} />
        ))}
      </div>
    </>
  );
}

function ServerPickerRow({ target, project, compat, close }: { target: ServerTargetInfo; project: PickerProject; compat: "ok" | "loader" | "version"; close: () => void }) {
  const t = useT();
  const { busy, install } = useServerInstall(target);
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState(false);
  const ok = compat === "ok";
  const note = compat === "loader" ? t("st.reason.loader", { software: softwareLabel(target) }) : compat === "version" ? t("st.reason.version", { mc: target.mc_version }) : null;
  const run = async () => {
    setChecking(true);
    try {
      const c = await providerOf(target).check(target, "modrinth", project.id).catch(() => null);
      if (c?.installed) {
        toast.success(tt("st.already", { name: project.title, server: target.name }));
        setDone(true);
        return;
      }
      if (c && !c.ok) {
        if (c.reason !== "client_only") {
          toast.error(checkText(c, target), project.title);
          return;
        }
        const yes = await confirm({ title: tt("st.force.title", { name: project.title }), text: checkText(c, target), confirmLabel: tt("st.force.confirm") });
        if (!yes) return;
      }
    } finally {
      setChecking(false);
    }
    const files = await install("modrinth", project.id, project.title);
    if (files) {
      setDone(true);
      close();
    }
  };
  const loading = checking || busy === `modrinth:${project.id}`;
  return (
    <button
      disabled={loading || !ok}
      onClick={() => void run()}
      className="group flex h-11 w-full items-center gap-2.5 rounded-ctl px-2 text-left outline-none transition-colors hover:bg-white/[.07] focus-visible:bg-white/[.07] disabled:cursor-default"
      data-testid="picker-server-row"
    >
      <span className={cn(!ok && "opacity-50")}>
        <TargetIcon target={target} size={26} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13px] font-medium leading-tight", ok ? "text-text" : "text-muted")}>{target.name}</span>
        <span className="block truncate text-[11.5px] leading-tight text-dim">
          {note ?? `${softwareLabel(target)} · ${target.mc_version}${target.origin === "remote" ? ` · ${target.agentName ?? t("st.remote")}` : ""}`}
        </span>
      </span>
      <span className="flex w-[78px] shrink-0 justify-end whitespace-nowrap text-[12px]">
        {loading ? (
          <Spinner size={11} className="text-dim" />
        ) : done ? (
          <span className="flex items-center gap-1 font-semibold text-ok">
            <Check size={13} strokeWidth={2.5} />
            {t("common.installed")}
          </span>
        ) : ok ? (
          <span className="flex items-center gap-1 font-semibold text-text opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Download size={13} />
            {t("common.install")}
          </span>
        ) : null}
      </span>
    </button>
  );
}
