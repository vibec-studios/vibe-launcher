import { useState } from "react";
import { Import, Plus, Save } from "lucide-react";
import { api } from "@/lib/api";
import type { Appearance, CustomTheme, ThemeValues } from "@/lib/types";
import {
  FILE_EXT,
  MAX_CUSTOM_THEMES,
  applyCustom,
  cleanName,
  exportCode,
  exportFile,
  fileName,
  isCustomModified,
  newThemeId,
  snapshot,
  uniqueName,
} from "@/lib/customThemes";
import { copyText } from "@/components/content/util";
import { Button, SettingsCard, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { CustomThemeTile } from "./CustomThemeTile";
import { ImportThemeDialog } from "./ImportThemeDialog";

export function CustomThemesCard({ a, set }: { a: Appearance; set: (p: Partial<Appearance>) => void }) {
  const t = useT();
  const [importing, setImporting] = useState(false);
  const list = a.custom_themes;
  const active = list.find((x) => x.id === a.active_custom) ?? null;
  const full = list.length >= MAX_CUSTOM_THEMES;

  const replace = (id: string, fn: (x: CustomTheme) => CustomTheme) => list.map((x) => (x.id === id ? fn(x) : x));
  const add = (name: string, values: ThemeValues) => {
    if (full) return toast.error(t("ct.full", { n: MAX_CUSTOM_THEMES }));
    const ct: CustomTheme = { id: newThemeId(), name: uniqueName(cleanName(name, t("ct.default_name")), list), values };
    set({ ...applyCustom(a, ct), custom_themes: [...list, ct] });
    toast.success(t("ct.saved", { name: ct.name }));
  };
  const saveCurrent = () => add(t("ct.default_name_n", { n: list.length + 1 }), snapshot(a));
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
  };
  const copy = async (ct: CustomTheme) => {
    await copyText(exportCode(ct));
    toast.success(t("ct.copied"));
  };
  const saveFile = async (ct: CustomTheme) => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: fileName(ct.name), filters: [{ name: t("ct.file_filter"), extensions: [FILE_EXT] }] });
    if (!path) return;
    try {
      await api.appearanceThemeWrite(path, exportFile(ct));
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
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} disabled={full} onClick={saveCurrent}>
            {t("ct.save_current")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4">
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
                onApply={() => set(applyCustom(a, ct))}
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
            <Button size="sm" variant="subtle" onClick={() => set(applyCustom(a, active))}>
              {t("ct.discard")}
            </Button>
          </div>
        )}
        <p className="text-[12px] text-dim">{t("ct.hint")}</p>
      </div>
      <ImportThemeDialog open={importing} onOpenChange={setImporting} onImport={add} />
    </SettingsCard>
  );
}
