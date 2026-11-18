// Tab „Darstellung“: Akzentfarbe, Ton, Ecken, Dichte, Skalierung, Hintergrund (Verlauf/Bild/animiert),
// Abdunklung/Unschärfe. Jede Änderung wirkt sofort (Vorschau über useAppearanceDraft) und speichert automatisch.
import { useEffect, useState, type ReactNode } from "react";
import { Boxes, Check, Film, ImagePlus, Pipette, Rainbow, RotateCcw, Sparkles, Trash2, Waves } from "lucide-react";
import { api } from "@/lib/api";
import type { Appearance, BackgroundAnimated, BackgroundGradient, BackgroundKind, Settings } from "@/lib/types";
import { ACCENT_PRESETS, DEFAULT_APPEARANCE, GRADIENTS, isVideoFile, normalizeAppearance, useAppearanceDraft } from "@/lib/appearance";
import { imageSrc } from "@/lib/format";
import { Button, Input, Segmented, SettingRow, SettingsCard, Slider, Switch, Tooltip, cn, toast } from "@/components/ui";
import { Backdrop } from "@/app/Backdrop";
import { useT } from "@/i18n";

type Update = (p: Partial<Settings>, delay?: number) => void;

const GRADIENT_KEYS: BackgroundGradient[] = ["accent", "dusk", "ocean", "ember", "forest"];
const ANIMATED: { key: BackgroundAnimated; icon: ReactNode }[] = [
  { key: "aurora", icon: <Rainbow size={18} /> },
  { key: "particles", icon: <Sparkles size={18} /> },
  { key: "waves", icon: <Waves size={18} /> },
  { key: "blocks", icon: <Boxes size={18} /> },
  { key: "custom", icon: <Film size={18} /> },
];

export function AppearanceTab({ s, update }: { s: Settings; update: Update }) {
  const t = useT();
  const a = normalizeAppearance(s.appearance);
  const b = a.background;

  // Vorschau: der ganze Launcher zeigt den Entwurf, solange dieser Tab offen ist
  const key = JSON.stringify(a);
  useEffect(() => {
    useAppearanceDraft.setState({ draft: a });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => useAppearanceDraft.setState({ draft: null }), []);

  const set = (p: Partial<Appearance>, delay?: number) => update({ appearance: { ...a, ...p } }, delay);
  const setBg = (p: Partial<Appearance["background"]>, delay?: number) => set({ background: { ...b, ...p } }, delay);

  return (
    <>
      <div className="flex items-end gap-4">
        <MiniPreview a={a} />
        <div className="flex flex-1 flex-col items-end self-stretch">
          <Button
            size="sm"
            variant="subtle"
            icon={<RotateCcw size={13} />}
            onClick={() => {
              set({ ...DEFAULT_APPEARANCE, background: { ...DEFAULT_APPEARANCE.background, image: b.image, video: b.video } });
              toast.info(t("ap.reset.done"));
            }}
          >
            {t("ap.reset")}
          </Button>
        </div>
      </div>

      <SettingsCard title={t("ap.section.color")}>
        <SettingRow title={t("ap.accent")} description={t("ap.accent.desc")} stacked>
          <AccentPicker value={a.accent} onChange={(accent, d) => set({ accent }, d)} />
        </SettingRow>
        <SettingRow title={t("ap.tone")} description={t("ap.tone.desc")}>
          <Segmented
            value={a.tone}
            onChange={(tone) => set({ tone })}
            items={(["dark", "dim", "oled"] as const).map((v) => ({ value: v, label: t(`ap.tone.${v}`) }))}
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("ap.section.shape")}>
        <SettingRow title={t("ap.radius")} description={t("ap.radius.desc")}>
          <Segmented
            value={a.radius}
            onChange={(radius) => set({ radius })}
            items={(["square", "slight", "round"] as const).map((v) => ({
              value: v,
              label: (
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-3 w-3 border-[1.5px] border-current opacity-80"
                    style={{ borderRadius: v === "square" ? 0 : v === "slight" ? 2 : 4.5 }}
                  />
                  {t(`ap.radius.${v}`)}
                </span>
              ),
            }))}
          />
        </SettingRow>
        <SettingRow title={t("ap.density")} description={t("ap.density.desc")}>
          <Segmented
            value={a.density}
            onChange={(density) => set({ density })}
            items={(["compact", "normal"] as const).map((v) => ({ value: v, label: t(`ap.density.${v}`) }))}
          />
        </SettingRow>
        <SettingRow title={t("ap.scale")} description={t("ap.scale.desc")}>
          <SliderValue value={a.ui_scale} min={80} max={130} step={5} unit="%" onChange={(ui_scale) => set({ ui_scale }, 350)} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("ap.section.background")}>
        <SettingRow title={t("ap.bg.kind")} description={`${t("ap.bg.kind.desc")} ${t("ap.paused_hint")}`} stacked>
          <div className="flex flex-col gap-3">
            <Segmented<BackgroundKind>
              value={b.kind}
              onChange={(kind) => setBg({ kind })}
              items={(["none", "gradient", "image", "animated"] as const).map((v) => ({ value: v, label: t(`ap.bg.${v}`) }))}
            />
            {b.kind === "gradient" && (
              <div className="flex flex-wrap gap-2">
                {GRADIENT_KEYS.map((g) => (
                  <PresetTile key={g} label={t(`ap.grad.${g}`)} active={b.gradient === g} onClick={() => setBg({ gradient: g })}>
                    <span className="absolute inset-0" style={{ background: GRADIENTS[g](a.accent) }} />
                  </PresetTile>
                ))}
              </div>
            )}
            {b.kind === "image" && (
              <FilePick
                slot="image"
                path={b.image}
                onPicked={(image) => setBg({ image, kind: "image" })}
                onRemove={() => setBg({ image: null, kind: "none" })}
              />
            )}
            {b.kind === "animated" && (
              <>
                <div className="flex flex-wrap gap-2">
                  {ANIMATED.map(({ key, icon }) => (
                    <PresetTile key={key} label={t(`ap.anim.${key}`)} active={b.animated === key} onClick={() => setBg({ animated: key })}>
                      <span className="absolute inset-0 grid place-items-center bg-white/[.05] text-muted">
                        {icon}
                      </span>
                    </PresetTile>
                  ))}
                </div>
                {b.animated === "custom" && (
                  <FilePick slot="video" path={b.video} onPicked={(video) => setBg({ video })} onRemove={() => setBg({ video: null, animated: "aurora" })} />
                )}
              </>
            )}
          </div>
        </SettingRow>
        <SettingRow title={t("ap.dim")} description={t("ap.dim.desc")} className={cn(b.kind === "none" && "opacity-50")}>
          <SliderValue value={b.dim} min={0} max={90} step={5} unit="%" disabled={b.kind === "none"} onChange={(dim) => setBg({ dim }, 300)} />
        </SettingRow>
        <SettingRow title={t("ap.blur")} description={t("ap.blur.desc")} className={cn(b.kind === "none" && "opacity-50")}>
          <SliderValue value={b.blur} min={0} max={40} step={2} unit="px" disabled={b.kind === "none"} onChange={(blur) => setBg({ blur }, 300)} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("ap.section.more")}>
        <SettingRow title={t("settings.reduce_motion")} description={t("settings.reduce_motion.desc")}>
          <Switch
            checked={s.reduce_motion}
            onChange={(reduce_motion) => {
              document.documentElement.dataset.reduceMotion = String(reduce_motion);
              update({ reduce_motion });
            }}
            label={t("settings.reduce_motion")}
          />
        </SettingRow>
        <SettingRow title={t("settings.minecraftcapes")} description={t("settings.minecraftcapes.desc")}>
          <Switch checked={s.minecraftcapes} onChange={(minecraftcapes) => update({ minecraftcapes })} label={t("settings.minecraftcapes")} />
        </SettingRow>
      </SettingsCard>
    </>
  );
}

// ------------------------------------------------------------------ Bausteine

/** Verkleinerter Launcher: Rahmen, Seitenleiste, Bühne und Kacheln – liest dieselben CSS-Variablen. */
function MiniPreview({ a }: { a: Appearance }) {
  const t = useT();
  return (
    <div className="relative h-[168px] w-[300px] shrink-0 overflow-hidden rounded-card bg-[var(--tone-frame)] shadow-[0_0_0_1px_var(--line-2)]" aria-label={t("ap.preview")}>
      <Backdrop appearance={a} contained />
      <div className="absolute inset-0 flex">
        <div className="flex w-8 flex-col items-center gap-1.5 bg-bg pt-2">
          <span className="h-4 w-4 rounded-xs bg-brand/80" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-4 w-4 rounded-xs bg-white/10" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="h-5 bg-bg" />
          <div className="flex flex-1 flex-col gap-2 rounded-tl-card bg-panel p-2.5">
            <div className="relative flex items-center gap-2 overflow-hidden rounded-card bg-surface p-2">
              <span className="h-7 w-7 rounded-ctl bg-surface3" />
              <span className="flex flex-1 flex-col gap-1">
                <span className="h-2 w-20 rounded-xs bg-white/80" />
                <span className="h-1.5 w-14 rounded-xs bg-white/25" />
              </span>
              <span className="h-5 w-12 rounded-ctl bg-brand" />
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="flex flex-col gap-1">
                  <span className="aspect-[4/3] rounded-ctl bg-surface" />
                  <span className="h-1.5 w-3/4 rounded-xs bg-white/30" />
                </span>
              ))}
            </div>
            <div className="mt-auto flex gap-1.5">
              <span className="h-4 w-14 rounded-ctl bg-surface2" />
              <span className="h-4 w-10 rounded-ctl bg-field" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccentPicker({ value, onChange }: { value: string; onChange: (v: string, delay?: number) => void }) {
  const t = useT();
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const custom = !ACCENT_PRESETS.includes(value.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ACCENT_PRESETS.map((c) => {
        const active = c === value.toLowerCase();
        return (
          <button
            key={c}
            aria-label={c}
            aria-pressed={active}
            onClick={() => onChange(c)}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-ctl transition-transform duration-100 hover:scale-105",
              active && "outline outline-2 outline-offset-2 outline-white/80",
            )}
            style={{ background: c }}
          >
            {active && <Check size={15} strokeWidth={3} className="text-black/70" />}
          </button>
        );
      })}
      <span className="mx-1 h-6 w-px bg-line2" />
      <Tooltip content={t("ap.accent.custom")}>
        <label
          className={cn(
            "relative grid h-8 w-8 cursor-pointer place-items-center rounded-ctl bg-surface3 text-muted hover:text-text",
            custom && "outline outline-2 outline-offset-2 outline-white/80",
          )}
          style={custom ? { background: value, color: "rgb(0 0 0 / .7)" } : undefined}
        >
          <Pipette size={14} />
          <input
            type="color"
            aria-label={t("ap.accent.custom")}
            value={value}
            onChange={(e) => onChange(e.target.value, 250)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </Tooltip>
      <Input
        aria-label={t("ap.accent.custom")}
        value={hex}
        maxLength={7}
        onChange={(e) => {
          const v = e.target.value.trim();
          setHex(v);
          if (/^#?[0-9a-f]{6}$/i.test(v)) onChange((v.startsWith("#") ? v : `#${v}`).toLowerCase(), 400);
        }}
        className="w-[108px] font-mono text-[12.5px] [&_input]:h-8"
        leading={<span className="block h-3 w-3 rounded-xs" style={{ background: value }} />}
      />
    </div>
  );
}

function SliderValue({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-[260px] max-w-full items-center gap-3">
      <Slider value={value} min={min} max={max} step={step} disabled={disabled} onChange={onChange} />
      <span className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">
        {value}
        {unit === "%" ? " %" : ` ${unit}`}
      </span>
    </div>
  );
}

function PresetTile({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active} className="group flex w-[84px] flex-col items-center gap-1.5">
      <span
        className={cn(
          "relative h-[52px] w-full overflow-hidden rounded-card",
          active ? "outline outline-2 outline-offset-2 outline-brand" : "group-hover:outline group-hover:outline-1 group-hover:outline-offset-2 group-hover:outline-white/25",
        )}
      >
        {children}
      </span>
      <span className={cn("text-[12px] font-medium", active ? "text-text" : "text-muted group-hover:text-text")}>{label}</span>
    </button>
  );
}

function FilePick({ slot, path, onPicked, onRemove }: { slot: "image" | "video"; path: string | null; onPicked: (p: string) => void; onRemove: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const src = imageSrc(path);
  const pick = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({
      multiple: false,
      directory: false,
      filters:
        slot === "image"
          ? [{ name: t("ap.file.filter"), extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"] }]
          : [{ name: t("ap.file.filter_video"), extensions: ["mp4", "webm", "gif", "webp"] }],
    });
    if (typeof file !== "string") return;
    setBusy(true);
    try {
      onPicked(await api.appearanceImportBackground(file, slot));
    } catch (e) {
      toast.error(e, t("ap.file.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-[52px] w-[84px] shrink-0 place-items-center overflow-hidden rounded-card bg-white/[.05] text-dim">
        {src ? (
          isVideoFile(path) ? (
            <video src={src} muted loop autoPlay playsInline className="h-full w-full object-cover" />
          ) : (
            <img src={src} alt="" className="h-full w-full object-cover" />
          )
        ) : slot === "image" ? (
          <ImagePlus size={18} />
        ) : (
          <Film size={18} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex gap-2">
          <Button size="sm" loading={busy} icon={slot === "image" ? <ImagePlus size={13} /> : <Film size={13} />} onClick={() => void pick()}>
            {path ? t("ap.file.change") : t(slot === "image" ? "ap.file.image" : "ap.file.video")}
          </Button>
          {path && (
            <Button size="sm" variant="subtle" icon={<Trash2 size={13} />} onClick={onRemove}>
              {t("ap.file.remove")}
            </Button>
          )}
        </div>
        <span className="text-[12px] text-dim">{t(slot === "image" ? "ap.file.image.desc" : "ap.file.video.desc")}</span>
      </div>
    </div>
  );
}
