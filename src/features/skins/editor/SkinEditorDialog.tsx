import { Check, RotateCw, Save } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, Checkbox, Dialog, IconButton, Input, Segmented, Spinner, Tooltip, confirm, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { LibrarySkin, SkinVariant } from "@/lib/types";
import { Term } from "@/features/help/glossary/Term";
import { ColorPanel } from "./ColorPanel";
import { EditorCanvas } from "./EditorCanvas";
import { EditorToolbar } from "./EditorToolbar";
import type { Hit } from "./layout";
import { LibraryPicker } from "./LibraryPicker";
import { PartsPanel } from "./PartsPanel";
import { pixelsFromUrl, pixelsToDataUrl, templatePixels } from "./pixels";
import { ToolPanel } from "./ToolPanel";
import { useEditorShortcuts } from "./shortcuts";
import { useSkinEditor } from "./useSkinEditor";

const SkinViewer3D = lazy(() => import("../SkinViewer3D"));

export interface EditorSource {
  dataUrl: string | null;
  name: string | null;
  variant: SkinVariant;
}

export interface EditorAccount {
  id: string;
  name: string;
  skin: { dataUrl: string; variant: SkinVariant } | null;
}

function HoverInfo({ hit, locked }: { hit: Hit | null; locked: boolean }) {
  const t = useT();
  if (!hit) return <span className="text-dim">{t("skined.hover_none")}</span>;
  const vars = { part: t(`skined.part.${hit.part}`), face: t(`skined.face.${hit.face}`), layer: t(`skined.layer.${hit.layer}`) };
  return <span className={locked ? "text-dim" : "text-muted"}>{t(locked ? "skined.hover_locked" : "skined.hover", vars)}</span>;
}

export function SkinEditorDialog({
  open,
  onOpenChange,
  source,
  account,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source: EditorSource | null;
  account: EditorAccount | null;
}) {
  const t = useT();
  const ed = useSkinEditor();
  const [name, setName] = useState("");
  const [hover, setHover] = useState<Hit | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rotate, setRotate] = useState(false);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState<"save" | "apply" | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef(0);

  const loadSource = async (s: EditorSource | null) => {
    setLoading(true);
    try {
      const px = s?.dataUrl ? await pixelsFromUrl(s.dataUrl) : templatePixels(s?.variant ?? "classic");
      ed.load(px, s?.variant ?? "classic");
      setName(s?.name ? tt("skined.name_copy", { name: s.name }) : tt("skined.name_default"));
    } catch (e) {
      toast.error(e, tt("skined.error.load"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadSource(source);
  }, [open, source]);

  useEffect(() => {
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      setPreview(pixelsToDataUrl(ed.px.current));
    }, 90);
  }, [ed.version, ed.px]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      timer.current = 0;
    },
    [],
  );

  useEditorShortcuts(ed, open && !picker && !busy);

  const guard = async (title: string, text: string, label: string) =>
    !ed.dirty || (await confirm({ title, text, confirmLabel: label, danger: true }));

  const close = async () => {
    if (busy) return;
    if (await guard(tt("skined.discard_title"), tt("skined.discard_text"), tt("skined.discard"))) onOpenChange(false);
  };

  const replaceWith = async (s: EditorSource | null) => {
    if (await guard(tt("skined.replace_title"), tt("skined.replace_text"), tt("skined.replace"))) await loadSource(s);
  };

  const save = async (apply: boolean) => {
    const finalName = name.trim() || tt("skined.name_default");
    setBusy(apply ? "apply" : "save");
    try {
      const skin = await api.skinLibraryAddData(pixelsToDataUrl(ed.px.current), finalName, ed.variant);
      void queryClient.invalidateQueries({ queryKey: ["skin-library"] });
      if (apply && account) {
        const p = await api.skinApplyLibrary(account.id, skin.id, ed.variant);
        queryClient.setQueryData(["skins-profile", p.account_id], p);
        toast.success(tt("skined.applied", { name: skin.name }));
      } else {
        toast.success(tt("skined.saved", { name: skin.name }));
      }
      ed.setDirty(false);
      onOpenChange(false);
    } catch (e) {
      toast.error(e, tt("skined.error.save"));
    } finally {
      setBusy(null);
    }
  };

  const hoverLocked = !!hover && (hover.layer !== ed.layer || (ed.focus !== "all" && hover.part !== ed.focus));

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => (o ? onOpenChange(true) : void close())}
        title={t("skined.title")}
        description={t("skined.subtitle")}
        size="xl"
        locked={!!busy}
        className="h-[min(900px,calc(100vh-48px))]! max-h-none! w-[min(1360px,calc(100vw-48px))]!"
        footer={
          <>
            <label className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-meta text-muted">{t("skined.name")}</span>
              <Input value={name} maxLength={48} onChange={(e) => setName(e.target.value)} className="w-[240px]" aria-label={t("skined.name")} />
            </label>
            <span className="ml-3 shrink-0 text-meta text-muted">
              <Term id="skinmodel">{t("skined.model")}</Term>
            </span>
            <Segmented
              value={ed.variant}
              onChange={ed.changeVariant}
              items={[
                { value: "classic", label: t("skins.classic") },
                { value: "slim", label: t("skins.slim") },
              ]}
            />
            <div className="flex-1" />
            <Button variant="subtle" onClick={() => void close()} disabled={!!busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="ghost" icon={<Save size={15} />} loading={busy === "save"} disabled={!!busy || loading} onClick={() => void save(false)}>
              {t("skined.save")}
            </Button>
            <Tooltip content={account ? t("skined.save_apply_tip", { name: account.name }) : t("skined.no_account")}>
              <span>
                <Button variant="primary" icon={<Check size={15} />} loading={busy === "apply"} disabled={!account || !!busy || loading} onClick={() => void save(true)}>
                  {t("skined.save_apply")}
                </Button>
              </span>
            </Tooltip>
          </>
        }
      >
        <div className="grid h-full min-h-[520px] grid-cols-[264px_minmax(0,1fr)_300px] gap-4">
          <div className="scroll flex min-h-0 flex-col gap-5 pr-1">
            <ToolPanel ed={ed} />
            <ColorPanel ed={ed} />
          </div>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-card bg-surface">
            <EditorToolbar
              ed={ed}
              open={{
                template: () => void replaceWith({ dataUrl: null, name: null, variant: ed.variant }),
                current: account?.skin
                  ? { name: account.name, open: () => void replaceWith({ dataUrl: account.skin!.dataUrl, name: account.name, variant: account.skin!.variant }) }
                  : undefined,
                library: () => setPicker(true),
              }}
            />
            <div className="relative min-h-0 flex-1 bg-surface2">
              {loading ? (
                <div className="absolute inset-0 grid place-items-center">
                  <Spinner size={20} />
                </div>
              ) : (
                <EditorCanvas ed={ed} onHover={setHover} />
              )}
            </div>
            <div className="flex h-9 shrink-0 items-center truncate px-3 text-[12.5px]">
              <HoverInfo hit={hover} locked={hoverLocked} />
            </div>
          </section>

          <div className="scroll flex min-h-0 flex-col gap-4">
            <section className="relative h-[340px] shrink-0 overflow-hidden rounded-card bg-surface">
              <div className="absolute left-3 top-2 z-10 text-section text-muted">{t("skined.preview")}</div>
              {preview && (
                <Suspense fallback={null}>
                  <SkinViewer3D skin={preview} variant={ed.variant} cape={null} animation="idle" autoRotate={rotate} showOuter={ed.showOverlay} />
                </Suspense>
              )}
              <div className="absolute bottom-2 right-2 z-10">
                <IconButton label={t("skins.rotate")} tip tipSide="left" variant="ghost" size="sm" active={rotate} onClick={() => setRotate((r) => !r)}>
                  <RotateCw size={14} />
                </IconButton>
              </div>
            </section>
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-text">
              <Checkbox checked={ed.showOverlay} onChange={ed.setShowOverlay} />
              {t("skined.show_overlay")}
            </label>
            <PartsPanel ed={ed} />
          </div>
        </div>
      </Dialog>
      <LibraryPicker
        open={picker}
        onOpenChange={setPicker}
        onPick={(s: LibrarySkin) => void replaceWith({ dataUrl: s.data_url, name: s.name, variant: s.variant })}
      />
    </>
  );
}
