import { FileArchive, FolderOpen, Gamepad2, Plus, Server as ServerLucide } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { useT } from "@/i18n";
import { formatLoader } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { ChoiceCard } from "@/features/servers/new/ChoiceCard";
import type { ServerTargetInfo } from "@/features/installtarget/types";
import { softwareLabel } from "@/features/discover/server/parts";

export type SourceKind = "instance" | "file";
export type TargetKind = "new" | "existing";

export async function pickPackFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, filters: [{ name: "Modpack", extensions: ["mrpack", "zip", "vlpack"] }] });
  return typeof r === "string" ? r : null;
}

export function SourceStep({
  kind,
  setKind,
  instances,
  instanceId,
  setInstanceId,
  file,
  setFile,
}: {
  kind: SourceKind;
  setKind: (k: SourceKind) => void;
  instances: Instance[];
  instanceId: string | null;
  setInstanceId: (id: string) => void;
  file: string | null;
  setFile: (p: string | null) => void;
}) {
  const t = useT();
  const modded = instances.filter((i) => i.loader.kind !== "vanilla");
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3" role="radiogroup">
        <ChoiceCard icon={<Gamepad2 size={20} />} title={t("sp.source.instance")} text={t("sp.source.instance_text")} selected={kind === "instance"} onSelect={() => setKind("instance")} />
        <ChoiceCard icon={<FileArchive size={20} />} title={t("sp.source.file")} text={t("sp.source.file_text")} selected={kind === "file"} onSelect={() => setKind("file")} />
      </div>
      {kind === "instance" ? (
        <Field label={t("sp.source.pick_instance")} hint={modded.length === 0 ? t("sp.source.no_instances") : undefined}>
          <Select
            value={instanceId}
            onChange={setInstanceId}
            placeholder={t("sp.source.pick_instance")}
            options={modded.map((i) => ({ value: i.id, label: `${i.name} · ${formatLoader(i.loader)} ${i.mc_version}` }))}
          />
        </Field>
      ) : (
        <Field label={t("sp.source.pick_file")} hint={t("sp.source.formats")}>
          <div className="flex items-center gap-2">
            <Input className="min-w-0 flex-1" value={file ?? ""} readOnly placeholder={t("sp.source.no_file")} onClick={() => void pickPackFile().then((p) => p && setFile(p))} />
            <Button variant="subtle" icon={<FolderOpen size={14} />} onClick={() => void pickPackFile().then((p) => p && setFile(p))}>
              {t("sp.source.browse")}
            </Button>
          </div>
        </Field>
      )}
    </div>
  );
}

export function TargetStep({
  kind,
  setKind,
  servers,
  serverKey,
  setServerKey,
  agents,
  where,
  setWhere,
  name,
  setName,
}: {
  agents: { id: string; label: string }[];
  where: string;
  setWhere: (w: string) => void;
  kind: TargetKind;
  setKind: (k: TargetKind) => void;
  servers: ServerTargetInfo[];
  serverKey: string | null;
  setServerKey: (k: string) => void;
  name: string;
  setName: (n: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3" role="radiogroup">
        <ChoiceCard icon={<Plus size={20} />} title={t("sp.target.new")} text={t("sp.target.new_text")} selected={kind === "new"} onSelect={() => setKind("new")} />
        <ChoiceCard
          icon={<ServerLucide size={20} />}
          title={t("sp.target.existing")}
          text={t("sp.target.existing_text")}
          selected={kind === "existing"}
          disabled={servers.length === 0}
          onSelect={() => setKind("existing")}
        />
      </div>
      {kind === "new" ? (
        <div className={agents.length ? "grid grid-cols-2 gap-5" : ""}>
          <Field label={t("sp.target.name")} hint={t("sp.target.name_hint")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          {agents.length > 0 && (
            <Field label={t("sp.target.where")}>
              <Select value={where} onChange={setWhere} options={[{ value: "local", label: t("sp.target.this_pc") }, ...agents.map((a) => ({ value: a.id, label: a.label }))]} />
            </Field>
          )}
        </div>
      ) : (
        <Field label={t("sp.target.pick_server")} hint={t("sp.target.snapshot_hint")}>
          <Select
            value={serverKey}
            onChange={setServerKey}
            placeholder={t("sp.target.pick_server")}
            options={servers.map((s) => ({
              value: s.key,
              label: `${s.name} · ${softwareLabel(s)} ${s.mc_version}${s.origin === "remote" ? ` · ${s.agentName ?? t("st.remote")}` : ""}`,
            }))}
          />
        </Field>
      )}
    </div>
  );
}
