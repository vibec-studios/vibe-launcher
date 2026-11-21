import { Ban, ImageIcon, RotateCcw } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { InstanceIcon } from "../InstanceIcon";
import { BACKGROUNDS, DESIGNS, autoDesign, backgroundCss, formatBlockIcon, parseBlockIcon, type Background } from "./catalog";
import type { Design } from "./types";

const SECTIONS: { key: string; kinds: Design["kind"] }[] = [
  { key: "iconart.section.blocks", kinds: "iso" },
  { key: "iconart.section.patterns", kinds: "flat" },
];

export function IconGallery({
  value,
  accent,
  seed,
  onChange,
  onImage,
  onReset,
}: {
  value: string | null;
  accent: string;
  seed?: string;
  onChange: (icon: string) => void;
  onImage?: () => void;
  onReset?: () => void;
}) {
  const t = useT();
  const parsed = parseBlockIcon(value, seed);
  const auto = !value && seed ? autoDesign(seed) : null;
  const design = parsed?.design.id ?? auto?.id ?? null;
  const bg = parsed?.bg ?? null;
  const pickBg = (b: Background | null) => onChange(formatBlockIcon(design ?? autoDesign(seed ?? "vibe").id, b));
  return (
    <div className="flex flex-col gap-3">
      <div className="-mr-2 flex max-h-[264px] flex-col gap-3 overflow-y-auto pr-2">
        {SECTIONS.map((s) => (
          <div key={s.key}>
            <div className="label mb-1.5">{t(s.key)}</div>
            <div role="radiogroup" aria-label={t(s.key)} className="grid grid-cols-[repeat(auto-fill,minmax(34px,1fr))] gap-1">
              {DESIGNS.filter((d) => d.kind === s.kinds).map((d) => {
                const on = d.id === design;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={t(`iconart.${d.id}`)}
                    title={t(`iconart.${d.id}`)}
                    onClick={() => onChange(formatBlockIcon(d.id, bg))}
                    className={cn(
                      "grid aspect-square place-items-center rounded-xs outline-none transition-transform duration-100 hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent",
                      on && "ring-2 ring-accent ring-offset-1 ring-offset-[var(--overlay,transparent)]",
                    )}
                  >
                    <InstanceIcon icon={formatBlockIcon(d.id, bg)} accent={accent} size={34} className="rounded-xs" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div>
        <div className="label mb-1.5">{t("iconart.background")}</div>
        <div role="radiogroup" aria-label={t("iconart.background")} className="flex flex-wrap gap-1">
          {[null, ...BACKGROUNDS].map((b) => {
            const on = b === bg && !!design;
            const label = t(`iconart.bg.${b ?? "none"}`);
            return (
              <button
                key={b ?? "none"}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={label}
                title={label}
                onClick={() => pickBg(b)}
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-xs bg-surface2 text-dim outline-none shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] focus-visible:ring-2 focus-visible:ring-accent",
                  on && "ring-2 ring-accent ring-offset-1 ring-offset-[var(--overlay,transparent)]",
                )}
                style={{ background: backgroundCss(b, accent) }}
              >
                {!b && <Ban size={12} />}
              </button>
            );
          })}
        </div>
      </div>
      {(onImage || onReset) && (
        <div className="flex gap-2">
          {onImage && (
            <Button size="sm" icon={<ImageIcon size={14} />} className="flex-1" onClick={onImage}>
              {t("newinst.icon.own")}
            </Button>
          )}
          {onReset && (
            <Button size="sm" variant="subtle" icon={<RotateCcw size={13} />} onClick={onReset}>
              {t("iconart.auto")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
