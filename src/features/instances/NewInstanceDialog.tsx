// „Neue Instanz“-Dialog (kompakt): Icon + Name, Loader, Minecraft-/Loader-Version als Auswahlfelder, Akzent + Gruppe.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ImageIcon, PackageOpen, X } from "lucide-react";
import { api } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import { accentPalette, imageSrc, loaderNames } from "@/lib/format";
import { Button, Dialog, IconButton, Input, Tooltip, cn, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { VersionPicker, type VersionValue } from "@/components/instance/VersionPicker";
import { installInstance, pickImage } from "@/components/instance/actions";
import { openImport } from "@/features/import/ImportDialog";
import { useT } from "@/i18n";
import { accentVars } from "@/components/instance/accent";

export function suggestName(v: VersionValue): string {
  if (!v.mc) return "";
  return v.loader === "vanilla" ? `Minecraft ${v.mc}` : `${loaderNames[v.loader]} ${v.mc}`;
}

export function AccentPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {accentPalette.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn("grid h-7 w-7 place-items-center rounded-ctl transition-opacity duration-100", c === value ? "opacity-100" : "opacity-70 hover:opacity-100")}
          style={{ background: c }}
        >
          {c === value && <Check size={14} strokeWidth={3} color="#000" />}
        </button>
      ))}
    </div>
  );
}

export function GroupInput({ value, onChange, groups, autoFocus }: { value: string; onChange: (v: string) => void; groups: string[]; autoFocus?: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("inst.group.placeholder")} maxLength={48} autoFocus={autoFocus} />
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onChange(g === value ? "" : g)}
              className={cn(
                "h-6 rounded-xs px-2 text-[12px] font-medium transition-colors",
                g === value ? "bg-accent text-[var(--on-accent)]" : "bg-white/[.06] text-muted hover:bg-white/[.1] hover:text-text",
              )}
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewInstanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const { data: instances = [] } = useInstances();
  const groups = [...new Set(instances.map((i) => i.group).filter((g): g is string => !!g))].sort();

  const [ver, setVer] = useState<VersionValue>({ mc: null, loader: "fabric", loaderVersion: null });
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [accent, setAccentState] = useState(accentPalette[0]);
  const [group, setGroup] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Beim Öffnen zurücksetzen
  useEffect(() => {
    if (!open) return;
    setName(suggestName(ver));
    setNameTouched(false);
    setGroup("");
    setIcon(null);
    setBusy(false);
    setAccentState(accentPalette[Math.floor(Math.random() * accentPalette.length)]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!nameTouched) setName(suggestName(ver));
  }, [ver.mc, ver.loader, nameTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsLoaderVersion = ver.loader !== "vanilla";
  const valid = !!ver.mc && name.trim().length > 0 && (!needsLoaderVersion || !!ver.loaderVersion);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const inst = await api.instanceCreate({
        name: name.trim(),
        mc_version: ver.mc!,
        loader: { kind: ver.loader, version: needsLoaderVersion ? ver.loaderVersion : null },
        accent,
        group: group.trim() || null,
      });
      if (icon) await api.instanceSetIcon(inst.id, icon).catch((e) => toast.error(e, t("inst.icon.failed")));
      onOpenChange(false);
      nav({ to: "/instances/$id", params: { id: inst.id }, search: { tab: "content" } });
      installInstance(inst.id);
    } catch (e) {
      toast.error(e, t("newinst.failed"));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("newinst.title")}
      description={t("newinst.desc")}
      size="md"
      locked={busy}
      footer={
        <>
          <Button
            variant="subtle"
            className="mr-auto"
            icon={<PackageOpen size={14} />}
            onClick={() => {
              onOpenChange(false);
              openImport();
            }}
          >
            {t("newinst.import")}
          </Button>
          <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!valid} loading={busy}>
            {t("newinst.create")}
          </Button>
        </>
      }
    >
      {/* Kein <form>: Segment-Knöpfe ohne type wären sonst Submit-Knöpfe. Enter in Textfeldern erstellt. */}
      <div
        className="flex flex-col gap-4"
        style={accentVars(accent)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className="flex items-end gap-3">
          <Tooltip content={t("inst.icon.choose")}>
            <button
              type="button"
              aria-label={t("inst.icon.choose")}
              className="group relative shrink-0 overflow-hidden rounded-card"
              onClick={async () => setIcon((await pickImage()) ?? icon)}
            >
              <InstanceIcon icon={icon ? imageSrc(icon) : null} accent={accent} size={56} />
              <span className="absolute inset-0 grid place-items-center bg-black/60 text-text opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                <ImageIcon size={16} />
              </span>
            </button>
          </Tooltip>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="label">{t("newinst.name")}</span>
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                placeholder={t("newinst.name_placeholder")}
                maxLength={64}
                aria-label={t("newinst.name")}
                autoFocus
              />
              {icon && (
                <IconButton label={t("inst.icon.reset")} tip variant="ghost" type="button" onClick={() => setIcon(null)}>
                  <X size={15} />
                </IconButton>
              )}
            </div>
          </div>
        </div>

        <VersionPicker
          value={ver}
          onChange={setVer}
          compact
          render={({ loader, list, loaderVersion }) => (
            <>
              {loader}
              <div className="grid grid-cols-2 gap-3">
                {list}
                {loaderVersion || <div />}
              </div>
            </>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="label">{t("inst.accent")}</span>
            <AccentPicker value={accent} onChange={setAccentState} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="label">{t("inst.group")}</span>
            <GroupInput value={group} onChange={setGroup} groups={groups} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
