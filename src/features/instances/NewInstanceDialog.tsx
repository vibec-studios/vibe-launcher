// „Neue Instanz“-Dialog: Version + Loader links, Name/Icon/Akzent/Gruppe rechts.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ImageIcon, PackageOpen, X } from "lucide-react";
import { api } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import { accentPalette, imageSrc, loaderNames } from "@/lib/format";
import { Button, Dialog, Field, Input, Tooltip, cn, toast } from "@/components/ui";
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
          className={cn(
            "grid h-8 w-8 place-items-center border transition-transform duration-100 hover:-translate-y-px",
            c === value ? "border-white" : "border-transparent",
          )}
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
                "h-6 border px-2 font-mono text-[11px] transition-colors",
                g === value ? "border-accent bg-accent text-[var(--on-accent)]" : "border-line2 text-muted hover:border-accent hover:text-white",
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
      size="lg"
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
        className="flex flex-col gap-5"
        style={accentVars(accent)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <VersionPicker
          value={ver}
          onChange={setVer}
          listHeight={262}
          render={({ loader, list, loaderVersion }) => (
            <>
              {loader}
              <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-7">
                {list}
                <div className="flex flex-col gap-5">
                  <Field label={t("newinst.name")}>
                    <Input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setNameTouched(true);
                      }}
                      placeholder={t("newinst.name_placeholder")}
                      maxLength={64}
                      autoFocus
                    />
                  </Field>
                  {loaderVersion}
                  <div className="flex flex-col gap-1.5">
                    <span className="label">{t("inst.icon")}</span>
                    <div className="flex items-center gap-3">
                      <InstanceIcon icon={icon ? imageSrc(icon) : null} accent={accent} size={56} />
                      <div className="flex flex-col gap-1.5">
                        <Button size="sm" type="button" icon={<ImageIcon size={13} />} onClick={async () => setIcon((await pickImage()) ?? icon)}>
                          {t("inst.icon.choose")}
                        </Button>
                        {icon && (
                          <Tooltip content={icon}>
                            <Button size="sm" variant="subtle" type="button" icon={<X size={13} />} onClick={() => setIcon(null)}>
                              {t("inst.icon.reset")}
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </div>
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
            </>
          )}
        />
      </div>
    </Dialog>
  );
}
