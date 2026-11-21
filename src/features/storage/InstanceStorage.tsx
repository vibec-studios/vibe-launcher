import { ChevronDown, ChevronRight, Eraser } from "lucide-react";
import { useState } from "react";
import { Button, SettingsCard, Tooltip, cn, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatBytes } from "@/lib/format";
import { CLEARABLE_KINDS, storageApi, type InstanceUsage, type StorageFolder } from "./api";

const MIN_FOLDER = 1024 * 1024;

function FolderRow({ inst, f, max, onChanged }: { inst: InstanceUsage; f: StorageFolder; max: number; onChanged: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const clearable = CLEARABLE_KINDS.includes(f.kind) && f.name !== "";
  const clear = async () => {
    const ok = await confirm({
      title: t("disk.folder.clear_title", { folder: f.name }),
      text: t(`disk.folder.clear_text.${f.kind}`, { size: formatBytes(f.bytes) }),
      confirmLabel: t("disk.clean"),
      danger: f.kind === "rebuild",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const freed = await storageApi.clearFolder(inst.id, f.name);
      toast.success(t("disk.freed", { size: formatBytes(freed) }));
      onChanged();
    } catch (e) {
      toast.error(e, t("disk.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-mono text-[12px] text-text">{f.name || t("disk.folder.loose")}</span>
          <span className="shrink-0 text-meta text-dim">{t(`disk.kind.${f.kind}`)}</span>
        </div>
        <div className="text-meta text-muted">{t(`disk.kind.${f.kind}.desc`)}</div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface2">
          <div className={cn("h-full rounded-full", f.kind === "worlds" ? "bg-ok" : "bg-accent")} style={{ width: `${Math.max(1, Math.round((f.bytes / max) * 100))}%` }} />
        </div>
      </div>
      <span className="w-[72px] shrink-0 text-right text-caption tabular-nums text-text">{formatBytes(f.bytes)}</span>
      <div className="w-[96px] shrink-0 text-right">
        {clearable && (
          <Tooltip content={inst.running ? t("disk.folder.running") : null}>
            <Button size="sm" variant="ghost" icon={<Eraser size={13} />} loading={busy} disabled={busy || inst.running} onClick={clear}>
              {t("disk.folder.clear")}
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function InstanceRow({ inst, max, onChanged }: { inst: InstanceUsage; max: number; onChanged: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const folders = inst.folders.filter((f) => f.bytes >= MIN_FOLDER);
  const top = Math.max(1, ...folders.map((f) => f.bytes));
  return (
    <div className="border-b border-line last:border-b-0">
      <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[.03]" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={14} className="shrink-0 text-dim" /> : <ChevronRight size={14} className="shrink-0 text-dim" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] text-text">{inst.name}</span>
            {inst.running && <span className="shrink-0 rounded-full bg-ok/15 px-1.5 text-[10.5px] text-ok">{t("disk.running")}</span>}
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1, Math.round((inst.bytes / max) * 100))}%` }} />
          </div>
        </div>
        {inst.shared > 0 && <span className="shrink-0 text-meta text-ok">{t("disk.instance.shared", { size: formatBytes(inst.shared) })}</span>}
        <span className="w-[72px] shrink-0 text-right text-caption tabular-nums text-text">{formatBytes(inst.bytes)}</span>
      </button>
      {open && (
        <div className="pb-2 pl-6">
          {folders.length === 0 && <div className="px-4 py-2 text-meta text-muted">{t("disk.instance.small")}</div>}
          {folders.map((f) => (
            <FolderRow key={f.name} inst={inst} f={f} max={top} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

export function InstanceStorage({ instances, onChanged }: { instances: InstanceUsage[]; onChanged: () => void }) {
  const t = useT();
  if (!instances.length) return null;
  const max = Math.max(1, ...instances.map((i) => i.bytes));
  return (
    <SettingsCard title={t("disk.instances")}>
      <p className="px-4 pt-3 pb-1 text-meta text-muted">{t("disk.instances.desc")}</p>
      {instances.map((i) => (
        <InstanceRow key={i.id} inst={i} max={max} onChanged={onChanged} />
      ))}
    </SettingsCard>
  );
}
