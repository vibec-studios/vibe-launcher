import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { Button, ErrorState, toast } from "@/components/ui";
import { installInstance } from "@/components/instance/actions";
import { useT } from "@/i18n";
import { isCancelled } from "@/lib/api";
import { waitForTask } from "@/lib/queries";
import type { Instance } from "@/lib/types";

type Target = Pick<Instance, "mc_version" | "loader">;
interface Preview {
  token: string;
  items: { file_name: string; title: string; version: string | null; problem: string | null }[];
  dependencies: string[];
}

export function VersionMigration({ id, target, disabled, onCancel, onDone, children }: {
  id: string;
  target: Target | null;
  disabled: boolean;
  onCancel: () => void;
  onDone: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const check = async () => {
    if (!target) return;
    setChecking(true);
    setError(null);
    try {
      setPreview(await invoke<Preview>("instance_version_preview", { id, target }));
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  };
  const apply = async () => {
    if (!preview || !target) return;
    setApplying(true);
    try {
      const task = await invoke<string>("instance_version_apply", { id, target, token: preview.token });
      await waitForTask(task);
      installInstance(id);
      onDone();
    } catch (e) {
      if (!isCancelled(e)) toast.error(e);
      setPreview(null);
    } finally {
      setApplying(false);
    }
  };
  const available = preview?.items.filter((item) => item.problem === null).length ?? 0;

  return (
    <>
      {preview ? (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold text-text">{t("versionmove.preview", { version: target?.mc_version ?? "" })}</h3>
          <p className="text-[13px] text-text">{t("versionmove.counts", { available, missing: preview.items.length - available })}</p>
          {!!preview.items.length && (
            <ul className="scroll max-h-56 divide-y divide-line rounded-card bg-surface px-3">
              {preview.items.map((item) => (
                <li key={item.file_name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-[13px]">
                  <span className="min-w-0 break-words font-medium text-text">{item.title}</span>
                  <span className={item.problem ? "text-warn" : "text-ok"}>
                    {item.problem ? t(`versionmove.problem.${item.problem}`) : item.version}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!!preview.dependencies.length && <p className="text-[13px] text-muted">{t("versionmove.dependencies", { list: preview.dependencies.join(", ") })}</p>}
          <p className="text-[13px] text-muted">{t("versionmove.snapshot")}</p>
          {available < preview.items.length && <p className="text-[13px] text-warn">{t("versionmove.disabled")}</p>}
        </div>
      ) : (
        <>
          <div inert={checking}>{children}</div>
          {error != null && <ErrorState error={error} />}
        </>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="subtle" disabled={checking || applying} onClick={preview ? () => setPreview(null) : onCancel}>
          {t(preview ? "versionmove.back" : "common.cancel")}
        </Button>
        <Button variant="accent" disabled={disabled || !target} loading={preview ? applying : checking} onClick={preview ? apply : check}>
          {t(preview ? "versionmove.apply" : "versionmove.check")}
        </Button>
      </div>
    </>
  );
}
