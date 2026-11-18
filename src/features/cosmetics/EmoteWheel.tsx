// Emote-Rad belegen (8 Plätze wie im Client, Taste B): Platz wählen, dann Emote anklicken – oder umgekehrt.
import { Lock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Dialog, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { itemName } from "./data";
import { ItemThumb } from "./parts";
import { EMOTE_WHEEL_SIZE, type CatalogItem } from "./types";

export function EmoteWheelDialog({
  open,
  onOpenChange,
  arm,
  wheel,
  emotes,
  owned,
  lang,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Vorgemerktes Emote (aus der Detailansicht): nächster Klick auf einen Platz setzt es */
  arm: string | null;
  wheel: (string | null)[];
  emotes: CatalogItem[];
  owned: Set<string>;
  lang: string;
  onApply: (w: (string | null)[]) => void;
}) {
  const t = useT();
  const [slots, setSlots] = useState<(string | null)[]>([]);
  const [active, setActive] = useState(0);
  const [armed, setArmed] = useState<string | null>(null);
  const byId = new Map(emotes.map((e) => [e.id, e]));

  useEffect(() => {
    if (!open) return;
    const w = Array.from({ length: EMOTE_WHEEL_SIZE }, (_, i) => wheel[i] ?? null);
    setSlots(w);
    const already = arm ? w.indexOf(arm) : -1;
    setArmed(arm && already < 0 ? arm : null);
    const firstFree = w.indexOf(null);
    setActive(already >= 0 ? already : firstFree >= 0 ? firstFree : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const assign = (slot: number, id: string | null) => {
    setSlots((s) => {
      const n = s.map((x) => (id && x === id ? null : x));
      n[slot] = id;
      return n;
    });
  };

  const R = 150;
  const armedItem = armed ? byId.get(armed) : undefined;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={t("cos.wheel")}
      description={t("cos.wheel.lead")}
      footer={
        <>
          <Button variant="subtle" onClick={() => setSlots(Array(EMOTE_WHEEL_SIZE).fill(null))}>
            {t("cos.wheel.clear")}
          </Button>
          <span className="flex-1" />
          <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply(slots);
              onOpenChange(false);
            }}
          >
            {t("cos.wheel.apply")}
          </Button>
        </>
      }
    >
      <div className="flex gap-6">
        {/* Rad */}
        <div className="relative shrink-0" style={{ width: R * 2 + 96, height: R * 2 + 96 }}>
          <div className="absolute inset-[48px] rounded-full border border-line2 bg-[radial-gradient(circle,rgba(139,108,255,.14),transparent_70%)]" />
          <div className="absolute left-1/2 top-1/2 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-black/70 px-2 text-center text-[11px] leading-snug text-muted">
            {armedItem ? t("cos.wheel.place", { name: itemName(armedItem, lang) }) : t("cos.wheel.key")}
          </div>
          {slots.map((id, i) => {
            const a = (i / EMOTE_WHEEL_SIZE) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(a) * R + R + 48;
            const y = Math.sin(a) * R + R + 48;
            const item = id ? byId.get(id) : undefined;
            return (
              <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }}>
                <button
                  onClick={() => {
                    if (armed) {
                      assign(i, armed);
                      setArmed(null);
                    }
                    setActive(i);
                  }}
                  className={cn(
                    "relative flex h-[84px] w-[84px] flex-col items-center justify-center border bg-surface transition-colors",
                    active === i ? "border-brand bg-brand/[.12] shadow-[0_0_0_1px_var(--color-brand)]" : "border-line hover:border-line2",
                    armed && "border-dashed border-brand/70",
                  )}
                  title={item ? itemName(item, lang) : t("cos.wheel.empty")}
                >
                  <span className="absolute left-1 top-0.5 font-mono text-[10px] text-dim">{i + 1}</span>
                  {item ? (
                    <>
                      <ItemThumb item={item} className="h-12 w-12" />
                      <span className="mt-0.5 w-full truncate px-1 text-center text-[10px] text-text">{itemName(item, lang)}</span>
                    </>
                  ) : id ? (
                    <span className="px-1 text-center text-[10px] text-dim">{t("cos.wheel.unknown")}</span>
                  ) : (
                    <span className="text-[11px] text-dim">{t("cos.wheel.empty")}</span>
                  )}
                </button>
                {id && (
                  <button
                    aria-label={t("cos.wheel.remove")}
                    onClick={() => assign(i, null)}
                    className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center border border-line2 bg-black text-muted hover:text-white"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Emote-Liste */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-[12px] text-muted">{t("cos.wheel.pick", { n: active + 1 })}</div>
          <div className="scroll grid max-h-[420px] grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 pr-1">
            {emotes.map((e) => {
              const mine = owned.has(e.id);
              const used = slots.indexOf(e.id);
              return (
                <button
                  key={e.id}
                  disabled={!mine}
                  onClick={() => {
                    assign(active, e.id);
                    setArmed(null);
                    const next = slots.findIndex((x, i) => i !== active && x === null);
                    if (next >= 0) setActive(next);
                  }}
                  className={cn(
                    "relative flex flex-col border bg-surface text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                    used >= 0 ? "border-brand/50" : "border-line hover:border-line2",
                  )}
                >
                  <ItemThumb item={e} className="aspect-square w-full bg-black/40" />
                  <span className="truncate border-t border-line px-1.5 py-1 text-[11px] text-text">{itemName(e, lang)}</span>
                  {used >= 0 && <span className="absolute right-1 top-1 grid h-5 min-w-5 place-items-center bg-brand px-1 font-mono text-[10px] text-white">{used + 1}</span>}
                  {!mine && (
                    <span className="absolute left-1 top-1 grid h-5 w-5 place-items-center bg-black/80 text-muted">
                      <Lock size={10} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
