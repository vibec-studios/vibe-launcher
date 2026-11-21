import * as Popover from "@radix-ui/react-popover";
import { Check, ImageIcon } from "lucide-react";
import { accentPalette } from "@/lib/format";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { IconGallery } from "@/components/instance/blocks/IconGallery";
import { pickImage } from "@/components/instance/actions";
import { useT } from "@/i18n";

// ------------------------------------------------------------------ Icon + Farbe (Popover)

export function IconPicker({
  icon,
  accent,
  onIcon,
  onAccent,
}: {
  icon: string | null;
  accent: string;
  onIcon: (p: string | null) => void;
  onAccent: (c: string) => void;
}) {
  const t = useT();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" aria-label={t("inst.icon.choose")} className="group relative shrink-0 outline-none">
          <InstanceIcon icon={icon} accent={accent} size={64} />
          <span className="absolute inset-0 grid place-items-center bg-black/55 text-text opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100">
            <ImageIcon size={18} />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="scroll z-[60] max-h-[var(--radix-popover-content-available-height)] w-[316px] rounded-card bg-overlay p-3 shadow-e2 outline-none data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          <IconGallery value={icon} accent={accent} onChange={onIcon} onImage={async () => onIcon((await pickImage()) ?? icon)} />
          <div className="label mb-2 mt-3.5">{t("iconart.tint")}</div>
          <div className="grid grid-cols-8 gap-1">
            {accentPalette.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === accent}
                aria-label={c}
                onClick={() => onAccent(c)}
                className="grid aspect-square place-items-center rounded-xs transition-transform duration-100 hover:scale-110"
                style={{ background: c }}
              >
                {c === accent && <Check size={12} strokeWidth={3} color="#000" />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
