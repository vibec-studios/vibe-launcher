// OWNER: Frontend-Agent B. Global gemountet (main.tsx): Dateien aufs Fenster ziehen -> Import / Mods hinzufügen.
// Hält außerdem die globalen Dialoge dieses Bereichs (Import, Installation).
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileArchive, Info, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { qk, queryClient } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { hitTarget, useDragState } from "@/components/content/dragdrop";
import { ContentDialogHosts } from "./ContentDialogHosts";
import { currentPath, fileExt } from "@/components/content/util";
import { addContentFiles } from "@/features/content/addContentFiles";
import { PACK_EXTENSIONS, openImport } from "./importStore";

type Hint = { kind: "pack" } | { kind: "jar"; instance: Instance | null } | { kind: "none" };

function instanceFromPath(path: string): Instance | null {
  const m = /^\/instances\/([^/]+)/.exec(path);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  return queryClient.getQueryData<Instance[]>(qk.instances)?.find((i) => i.id === id) ?? queryClient.getQueryData<Instance>(qk.instance(id)) ?? null;
}

function classify(paths: string[]): Hint {
  if (paths.some((p) => PACK_EXTENSIONS.includes(fileExt(p)))) return { kind: "pack" };
  if (paths.some((p) => fileExt(p) === "jar")) return { kind: "jar", instance: instanceFromPath(currentPath()) };
  return { kind: "none" };
}

export function GlobalDropZone() {
  const t = useT();
  const paths = useDragState((s) => s.paths);
  const over = useDragState((s) => s.over);
  const [hint, setHint] = useState<Hint>({ kind: "none" });

  useEffect(() => {
    let un: (() => void) | undefined;
    let dead = false;
    let current: string[] = [];
    const dpr = () => window.devicePixelRatio || 1;
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === "enter") {
          current = p.paths;
          const pos = { x: p.position.x / dpr(), y: p.position.y / dpr() };
          const tgt = hitTarget(pos.x, pos.y, current);
          useDragState.setState({ paths: current, over: tgt?.id ?? null, pos: tgt ? pos : null });
          setHint(classify(current));
        } else if (p.type === "over") {
          const pos = { x: p.position.x / dpr(), y: p.position.y / dpr() };
          const tgt = hitTarget(pos.x, pos.y, current);
          const id = tgt?.id ?? null;
          if (useDragState.getState().over !== id || tgt) useDragState.setState({ over: id, pos: tgt ? pos : null });
        } else if (p.type === "drop") {
          const dropped = p.paths.length ? p.paths : current;
          const pos = { x: p.position.x / dpr(), y: p.position.y / dpr() };
          const tgt = hitTarget(pos.x, pos.y, dropped);
          useDragState.setState({ paths: null, over: null, pos: null });
          current = [];
          if (tgt) {
            tgt.onDrop(dropped, pos);
            return;
          }
          void handleGlobalDrop(dropped);
        } else {
          current = [];
          useDragState.setState({ paths: null, over: null, pos: null });
        }
      })
      .then((u) => {
        if (dead) u();
        else un = u;
      })
      .catch(() => {});
    return () => {
      dead = true;
      un?.();
    };
  }, []);

  const showOverlay = !!paths && !over;

  return (
    <>
      <ContentDialogHosts />
      {showOverlay && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 top-[48px] z-[90] flex items-center justify-center bg-bg/85 animate-fade-in">
          <div className="absolute inset-4 rounded-panel border-2 border-dashed border-accent/60" />
          <div className="relative flex max-w-[440px] flex-col items-center gap-3 text-center">
            {hint.kind === "pack" ? (
              <FileArchive size={36} className="text-accent" />
            ) : hint.kind === "jar" && hint.instance ? (
              <Upload size={36} className="text-accent" />
            ) : (
              <Info size={36} className="text-muted" />
            )}
            <div className="text-title text-text">
              {hint.kind === "pack"
                ? t("drop.import")
                : hint.kind === "jar"
                  ? hint.instance
                    ? t("drop.mods_into", { name: hint.instance.name })
                    : t("drop.mods_no_instance")
                  : t("drop.unsupported")}
            </div>
            <div className="text-[13px] text-muted">
              {hint.kind === "pack" ? t("drop.import_text") : hint.kind === "jar" ? (hint.instance ? t("drop.mods_text") : t("drop.mods_no_instance_text")) : t("drop.unsupported_text")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function handleGlobalDrop(paths: string[]) {
  const packs = paths.filter((p) => PACK_EXTENSIONS.includes(fileExt(p)));
  if (packs.length) {
    if (packs.length > 1) toast.info(tt("drop.one_pack"));
    openImport(packs[0]);
    return;
  }
  const jars = paths.filter((p) => fileExt(p) === "jar");
  if (jars.length) {
    const inst = instanceFromPath(currentPath());
    if (inst) await addContentFiles(inst.id, "mod", jars);
    else toast.info(tt("drop.mods_no_instance"), tt("drop.mods_no_instance_text"));
    return;
  }
  if (paths.length) toast.info(tt("drop.unsupported"), tt("drop.unsupported_text"));
}
