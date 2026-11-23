import { useState } from "react";
import { Import, Plus, Save, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { Appearance, CustomTheme, ThemeValues } from "@/lib/types";
import {
  FILE_EXT,
  LIMITS,
  MAX_CUSTOM_THEMES,
  applyCustom,
  cleanName,
  exportCode,
  exportFile,
  extensionOf,
  fileName,
  isCustomModified,
  newThemeId,
  snapshot,
  uniqueName,
  type ThemeDoc,
  type ThemeExtension,
} from "@/lib/customThemes";
import { copyText } from "@/components/content/util";
import { Button, SettingsCard, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { deleteExt, getExt, saveExt, setSafe, useThemeRuntime } from "@/features/themes/store";
import { CustomThemeTile } from "./CustomThemeTile";
import { ImportThemeDialog } from "./ImportThemeDialog";

export function CustomThemesCard({ a, set }: { a: Appearance; set: (p: Partial<Appearance>) => void }) {
  const t = useT();
  const [importing, setImporting] = useState(false);
  const safe = useThemeRuntime((s) => s.safe);
  const list = a.custom_themes;
  const active = list.find((x) => x.id === a.active_custom) ?? null;
  const full = list.length >= MAX_CUSTOM_THEMES;

  const replace = (id: string, fn: (x: CustomTheme) => CustomTheme) => list.map((x) => (x.id === id ? fn(x) : x));
  const apply = (ct: CustomTheme) => {
    setSafe(false);
    set(applyCustom(a, ct));
  };
  const add = async (name: string, values: ThemeValues, palette: CustomTheme["palette"], ext: ThemeExtension | null) => {
    if (full) return toast.error(t("ct.full", { n: MAX_CUSTOM_THEMES }));
    const ct: CustomTheme = { id: newThemeId(), name: uniqueName(cleanName(name, t("ct.default_name")), list), values };
    if (palette && Object.keys(palette).length) ct.palette = palette;
    try {
      if (ext) ct.ext = await saveExt(ct, ext);
    } catch (e) {
      return toast.error(e, t("ct.err.write"));
    }
    setSafe(false);
    set({ ...applyCustom(a, ct), custom_themes: [...list, ct] });
    if (ct.ext || ct.palette) toast.success(t("vt.applied", { name: ct.name }), t("vt.applied.text"));
    else toast.success(t("ct.saved", { name: ct.name }));
  };
  const importDoc = (doc: ThemeDoc) => void add(doc.name, doc.values, doc.palette, extensionOf(doc));
  const saveCurrent = async () => {
    const ext = active ? await getExt(active) : null;
    await add(t("ct.default_name_n", { n: list.length + 1 }), snapshot(a), active?.palette, ext);
  };
  const overwrite = (ct: CustomTheme) => {
    set({ custom_themes: replace(ct.id, (x) => ({ ...x, values: snapshot(a) })), active_custom: ct.id });
    toast.success(t("ct.updated", { name: ct.name }));
  };
  const rename = (ct: CustomTheme, name: string) => {
    const others = list.filter((x) => x.id !== ct.id);
    set({ custom_themes: replace(ct.id, (x) => ({ ...x, name: uniqueName(cleanName(name, ct.name), others) })) });
  };
  const remove = async (ct: CustomTheme) => {
    const ok = await confirm({ title: t("ct.delete.title", { name: ct.name }), text: t("ct.delete.text"), confirmLabel: t("ct.delete"), danger: true });
    if (!ok) return;
    set({ custom_themes: list.filter((x) => x.id !== ct.id), active_custom: a.active_custom === ct.id ? null : a.active_custom });
    if (ct.ext) void deleteExt(ct.id);
  };
  const copy = async (ct: CustomTheme) => {
    const code = exportCode(ct, await getExt(ct));
    if (code.length > LIMITS.code) return toast.info(t("vt.too_big_code"));
    await copyText(code);
    toast.success(t("ct.copied"));
  };
  const saveFile = async (ct: CustomTheme) => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: fileName(ct.name), filters: [{ name: t("ct.file_filter"), extensions: [FILE_EXT] }] });
    if (!path) return;
    try {
      await api.appearanceThemeWrite(path, exportFile(ct, await getExt(ct)));
      toast.success(t("ct.file_saved"));
    } catch (e) {
      toast.error(e, t("ct.err.write"));
    }
  };

  return (
    <SettingsCard
      title={t("ct.title")}
      right={
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="subtle" icon={<Import size={13} />} onClick={() => setImporting(true)}>
            {t("ct.import")}
          </Button>
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} disabled={full} onClick={() => void saveCurrent()}>
            {t("ct.save_current")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {safe && (
          <div className="flex flex-wrap items-center gap-2 rounded-ctl bg-warn/10 px-3 py-2">
            <ShieldAlert size={14} className="shrink-0 text-warn" />
            <span className="min-w-0 flex-1 text-[12.5px] text-text">{t("vt.safe.notice")}</span>
            <Button size="sm" variant="ghost" onClick={() => setSafe(false)}>
              {t("vt.safe.enable")}
            </Button>
          </div>
        )}
        {list.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-muted">{t("ct.empty")}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5">
            {list.map((ct) => (
              <CustomThemeTile
                key={ct.id}
                theme={ct}
                active={ct.id === a.active_custom}
                modified={ct.id === a.active_custom && isCustomModified(a, ct)}
                onApply={() => apply(ct)}
                onRename={(n) => rename(ct, n)}
                onOverwrite={() => overwrite(ct)}
                onCopy={() => void copy(ct)}
                onSaveFile={() => void saveFile(ct)}
                onDelete={() => void remove(ct)}
              />
            ))}
          </div>
        )}
        {active && isCustomModified(a, active) && (
          <div className="flex flex-wrap items-center gap-2 rounded-ctl bg-field px-3 py-2">
            <span className="min-w-0 flex-1 text-[12.5px] text-muted">{t("ct.changed", { name: active.name })}</span>
            <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={() => overwrite(active)}>
              {t("ct.save_changes")}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => apply(active)}>
              {t("ct.discard")}
            </Button>
          </div>
        )}
        <p className="text-[12px] text-dim">{t("ct.hint")}</p>
        <p className="text-[12px] text-dim">{t("vt.emergency")}</p>
      </div>
      <ImportThemeDialog open={importing} onOpenChange={setImporting} onImport={importDoc} />
    </SettingsCard>
  );
}
