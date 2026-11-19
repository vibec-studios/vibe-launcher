// Welt-Aktionen für den Welten-Tab: Backup erstellen, in andere Instanz kopieren, ZIP importieren.
import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { api, isCancelled } from "@/lib/api";
import { waitForTask, useJavaInstances } from "@/lib/queries";
import type { Instance, World } from "@/lib/types";
import { Button, Dialog, Field, Select, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { instanceAccent } from "@/lib/format";
import { t, useT } from "@/i18n";

/** Startet eine Backend-Aufgabe, wartet auf ihr Ende und meldet Erfolg/Fehler per Toast. */
export async function runBackupTask(start: () => Promise<string>, okTitle: string, failTitle: string, okText?: string): Promise<boolean> {
  try {
    const id = await start();
    await waitForTask(id);
    toast.success(okTitle, okText);
    return true;
  } catch (e) {
    if (!isCancelled(e)) toast.error(e, failTitle);
    return false;
  }
}

export function backupWorld(instance: Instance, world: World) {
  return runBackupTask(() => api.worldBackupCreate(instance.id, world.folder), t("worlds.backup.done"), t("worlds.backup.failed"), world.name);
}

export async function importWorldZip(instance: Instance) {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ multiple: false, directory: false, title: t("worlds.import.pick"), filters: [{ name: t("worlds.import.zip"), extensions: ["zip"] }] });
  if (typeof path !== "string") return false;
  return runBackupTask(() => api.worldImportZip(instance.id, path), t("worlds.import.done"), t("worlds.import.failed"), path.split(/[\\/]/).pop());
}

/** Dialog: Ziel-Instanz wählen und Welt dorthin kopieren. */
export function CopyWorldDialog({ instance, world, onClose }: { instance: Instance; world: World | null; onClose: () => void }) {
  const tr = useT();
  const all = useJavaInstances();
  const targets = useMemo(() => (all.data ?? []).filter((i) => i.id !== instance.id).sort((a, b) => a.name.localeCompare(b.name)), [all.data, instance.id]);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (world) setTarget(null);
  }, [world]);
  const sel = targets.find((i) => i.id === target) ?? null;

  const go = async () => {
    if (!world || !sel) return;
    setBusy(true);
    const ok = await runBackupTask(() => api.worldCopy(instance.id, world.folder, sel.id), tr("worlds.copy.done"), tr("worlds.copy.failed"), tr("worlds.copy.done_text", { name: sel.name }));
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog
      open={!!world}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={world ? tr("worlds.copy.title", { name: world.name }) : ""}
      description={tr("worlds.copy.text")}
      size="sm"
      locked={busy}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            {tr("common.cancel")}
          </Button>
          <Button variant="accent" icon={<Copy size={14} />} loading={busy} disabled={!sel} onClick={go}>
            {tr("worlds.copy.button")}
          </Button>
        </>
      }
    >
      {targets.length === 0 ? (
        <p className="text-[13px] text-muted">{tr("worlds.copy.no_targets")}</p>
      ) : (
        <Field label={tr("worlds.copy.target")}>
          <Select<string>
            value={target}
            onChange={setTarget}
            placeholder={tr("worlds.copy.pick")}
            options={targets.map((i) => ({
              value: i.id,
              label: (
                <span className="flex items-center gap-2">
                  <InstanceIcon icon={i.icon} accent={instanceAccent(i.id, i.accent)} size={18} />
                  <span className="truncate">{i.name}</span>
                  <span className="font-mono text-[11px] text-dim">{i.mc_version}</span>
                </span>
              ),
            }))}
          />
        </Field>
      )}
    </Dialog>
  );
}
