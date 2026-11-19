// Auswahl „Sicherung vorher“ für „Probleme beheben“ (Dialog) und Einstellungen → Spiel → Backups.
import { AlertTriangle } from "lucide-react";
import { Checkbox, Segmented, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { FixBackup, SnapshotScope } from "@/lib/types";

export const SNAPSHOT_SCOPES: SnapshotScope[] = ["mods", "configs", "resourcepacks", "shaderpacks", "datapacks", "options"];
/** Wie `FixBackup::RECOMMENDED` im Backend */
export const RECOMMENDED_SCOPES: SnapshotScope[] = ["mods", "configs", "options"];
export const DEFAULT_FIX_BACKUP: FixBackup = { mode: "recommended", areas: RECOMMENDED_SCOPES };

const MODES: FixBackup["mode"][] = ["recommended", "mods", "custom", "none"];

/** Bereiche, die mit dieser Wahl gesichert werden (leer = keine Sicherung). */
export function backupScopes(b: FixBackup | undefined): SnapshotScope[] {
  const v = b ?? DEFAULT_FIX_BACKUP;
  switch (v.mode) {
    case "none":
      return [];
    case "mods":
      return ["mods"];
    case "all":
      return SNAPSHOT_SCOPES;
    case "custom":
      return SNAPSHOT_SCOPES.filter((s) => v.areas.includes(s));
    default:
      return RECOMMENDED_SCOPES;
  }
}

/** „Mods, Configs und Optionen“ */
export function useScopeList() {
  const t = useT();
  return (scopes: SnapshotScope[] | null | undefined) => {
    const names = (scopes ?? SNAPSHOT_SCOPES).map((s) => t(`backups.scope.${s}`));
    return names.join(", ");
  };
}

export function FixBackupPicker({ value, onChange, className }: { value: FixBackup | undefined; onChange: (v: FixBackup) => void; className?: string }) {
  const t = useT();
  const v = value ?? DEFAULT_FIX_BACKUP;
  // "all" (nur über Einstellungsdatei) wie eine eigene Auswahl mit allem anzeigen
  const mode = v.mode === "all" ? "custom" : v.mode;
  const areas = v.mode === "all" ? SNAPSHOT_SCOPES : v.mode === "custom" ? v.areas : backupScopes(v);
  const setMode = (m: FixBackup["mode"]) => onChange({ mode: m, areas: m === "custom" ? (areas.length ? areas : RECOMMENDED_SCOPES) : v.areas });
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Segmented<FixBackup["mode"]> value={mode} onChange={setMode} items={MODES.map((m) => ({ value: m, label: t(`fix.backup.${m}`) }))} className="self-start" />
      {mode === "none" ? (
        <div className="flex items-start gap-2 rounded-ctl bg-warn/10 px-3 py-2 text-[12.5px] leading-snug text-text">
          <AlertTriangle size={14} className="mt-px shrink-0 text-warn" />
          {t("fix.backup.none.desc")}
        </div>
      ) : (
        <p className="text-[12.5px] leading-snug text-muted">{t(`fix.backup.${mode}.desc`)}</p>
      )}
      {mode === "custom" && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {SNAPSHOT_SCOPES.map((s) => {
              const on = areas.includes(s);
              const flip = () => onChange({ mode: "custom", areas: on ? areas.filter((x) => x !== s) : SNAPSHOT_SCOPES.filter((x) => x === s || areas.includes(x)) });
              return (
                <div key={s} className="flex cursor-pointer items-center gap-2 text-[13px] text-text">
                  <Checkbox checked={on} onChange={flip} label={t(`backups.scope.${s}`)} />
                  <span onClick={flip}>{t(`backups.scope.${s}`)}</span>
                </div>
              );
            })}
          </div>
          {!areas.length && <p className="text-[12px] text-warn">{t("fix.backup.empty")}</p>}
        </>
      )}
    </div>
  );
}
