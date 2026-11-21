import { Check, ChevronDown } from "lucide-react";
import { accentPalette, loaderNames } from "@/lib/format";
import { DropdownItem, DropdownMenu, Input, cn } from "@/components/ui";
import type { VersionValue } from "@/components/instance/VersionPicker";
import { useT } from "@/i18n";

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
            "grid h-7 w-7 place-items-center rounded-ctl transition-opacity duration-100",
            c === value ? "opacity-100" : "opacity-70 hover:opacity-100",
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
        // Mit Beschriftung, sonst wirken die Chips wie zufällige Schlagwörter
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[12px] text-dim">{t("inst.group.existing")}</span>
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


// ------------------------------------------------------------------ Gruppe (freier Text + vorhandene Gruppen)

export function GroupField({ value, onChange, groups }: { value: string; onChange: (v: string) => void; groups: string[] }) {
  const t = useT();
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("newinst.group.placeholder")}
      maxLength={48}
      aria-label={t("newinst.group")}
      trailing={
        groups.length > 0 && (
          <DropdownMenu
            align="end"
            trigger={
              <button
                type="button"
                aria-label={t("newinst.group")}
                className="grid h-7 w-7 place-items-center rounded-ctl text-dim hover:bg-white/[.07] hover:text-text"
              >
                <ChevronDown size={15} />
              </button>
            }
          >
            <DropdownItem onSelect={() => onChange("")}>{t("newinst.group.none")}</DropdownItem>
            {groups.map((g) => (
              <DropdownItem key={g} onSelect={() => onChange(g)} icon={g === value ? <Check size={14} /> : <span className="w-3.5" />}>
                {g}
              </DropdownItem>
            ))}
          </DropdownMenu>
        )
      }
    />
  );
}
