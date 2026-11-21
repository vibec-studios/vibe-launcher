// Tab „Darstellung“: Theme (Voreinstellung mit Extras), Farbe, Schrift, Form & Dichte, Seitenleiste, Bibliothek,
// Bewegung, Hintergrund. Jede Änderung wirkt sofort (Vorschau über useAppearanceDraft) und speichert automatisch.
import { useEffect, useState, type ReactNode } from "react";
import {
  Boxes,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Eye,
  EyeOff,
  Film,
  Home,
  ImagePlus,
  Images,
  LayoutGrid,
  LibraryBig,
  List,
  Pipette,
  Rainbow,
  RotateCcw,
  Server as ServerIcon,
  Shirt,
  Snowflake,
  Sparkles,
  Trash2,
  Users,
  Waves,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Appearance, BackgroundAnimated, BackgroundGradient, BackgroundKind, NavKey, Settings, ThemeId } from "@/lib/types";
import {
  ACCENT_PRESETS,
  DEFAULT_APPEARANCE,
  GRADIENTS,
  THEMES,
  THEME_IDS,
  applyTheme,
  effectiveAppearance,
  isThemeModified,
  isVideoFile,
  isWinterSeason,
  normalizeAppearance,
  themeExtra,
  useAppearanceDraft,
} from "@/lib/appearance";
import { imageSrc } from "@/lib/format";
import { AnimatedNumber, Button, IconButton, Input, Segmented, SettingRow, SettingsCard, Slider, Switch, Tag, Tooltip, cn, toast } from "@/components/ui";
import { Backdrop } from "@/app/Backdrop";
import { CustomThemesCard } from "./appearance/CustomThemesCard";
import { GradientEditor, SolidColorEditor } from "./appearance/BackgroundEditors";
import { Snowfall } from "@/app/Snowfall";
import { useT } from "@/i18n";

type Update = (p: Partial<Settings>, delay?: number) => void;

const GRADIENT_KEYS: Exclude<BackgroundGradient, "custom">[] = ["pixel", "accent", "dusk", "ocean", "ember", "forest"];
const ANIMATED: { key: BackgroundAnimated; icon: ReactNode }[] = [
  { key: "aurora", icon: <Rainbow size={18} /> },
  { key: "particles", icon: <Sparkles size={18} /> },
  { key: "waves", icon: <Waves size={18} /> },
  { key: "blocks", icon: <Boxes size={18} /> },
  { key: "custom", icon: <Film size={18} /> },
];
const NAV_ICONS: Record<NavKey, ReactNode> = {
  home: <Home size={15} />,
  instances: <LibraryBig size={15} />,
  servers: <ServerIcon size={15} />,
  social: <Users size={15} />,
  discover: <Compass size={15} />,
  skins: <Shirt size={15} />,
  cosmetics: <Sparkles size={15} />,
  screenshots: <Images size={15} />,
};

export function AppearanceTab({ s, update }: { s: Settings; update: Update }) {
  const t = useT();
  // Simple-Modus: nur die Basics (Theme, Akzentfarbe, Animationen)
  const a = normalizeAppearance(s.appearance);
  const b = a.background;
  const shown = effectiveAppearance(a);
  const theme = THEMES[shown.theme];

  // Vorschau: der ganze Launcher zeigt den Entwurf, solange dieser Tab offen ist
  const key = JSON.stringify(a);
  useEffect(() => {
    useAppearanceDraft.setState({ draft: a });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => useAppearanceDraft.setState({ draft: null }), []);

  const set = (p: Partial<Appearance>, delay?: number) => update({ appearance: { ...a, ...p } }, delay);
  const setBg = (p: Partial<Appearance["background"]>, delay?: number) => set({ background: { ...b, ...p } }, delay);
  const setFx = (p: Partial<Appearance["effects"]>, delay?: number) => set({ effects: { ...a.effects, ...p } }, delay);
  const setSidebar = (p: Partial<Appearance["sidebar"]>) => set({ sidebar: { ...a.sidebar, ...p } });
  const motion = s.reduce_motion ? "reduced" : a.motion;
  const seasonalActive = a.seasonal && a.theme === "standard" && isWinterSeason();

  const moveNav = (k: NavKey, dir: -1 | 1) => {
    const order = [...a.sidebar.order];
    const i = order.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setSidebar({ order });
  };
  const toggleNav = (k: NavKey) => {
    const hidden = a.sidebar.hidden.includes(k) ? a.sidebar.hidden.filter((x) => x !== k) : [...a.sidebar.hidden, k];
    setSidebar({ hidden });
  };

  return (
    <>
      {/* ---------------------------------------------------------- Theme + Live-Vorschau */}
      <SettingsCard
        title={t("ap.section.theme")}
        right={
          <Button
            size="sm"
            variant="subtle"
            icon={<RotateCcw size={13} />}
            onClick={() => {
              set({
                ...DEFAULT_APPEARANCE,
                background: { ...DEFAULT_APPEARANCE.background, image: b.image, video: b.video },
                custom_themes: a.custom_themes,
              });
              toast.info(t("ap.reset.done"));
            }}
          >
            {t("ap.reset_all")}
          </Button>
        }
      >
        <div className="flex flex-wrap items-start gap-5 p-4">
          <MiniPreview a={shown} />
          <div className="flex min-w-[260px] flex-1 flex-col gap-3">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5">
              {THEME_IDS.map((id) => (
                <ThemeTile
                  key={id}
                  id={id}
                  active={a.theme === id && !a.active_custom}
                  modified={a.theme === id && !a.active_custom && isThemeModified(a)}
                  onClick={() => set(applyTheme(a, id))}
                />
              ))}
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted">{t(`ap.theme.${shown.theme}.desc`)}</p>
            <div className="flex flex-wrap items-center gap-2">
              {isThemeModified(a) && !a.active_custom && (
                <Button size="sm" variant="subtle" icon={<RotateCcw size={13} />} onClick={() => set(applyTheme(a, a.theme))}>
                  {t("ap.theme.reset", { name: t(`ap.theme.${a.theme}`) })}
                </Button>
              )}
              {seasonalActive && (
                <Tag className="h-6 gap-1.5 px-2 text-[12px]">
                  <Snowflake size={12} /> {t("ap.seasonal.active")}
                </Tag>
              )}
            </div>
          </div>
        </div>
        <SettingRow title={t("ap.seasonal")} description={t("ap.seasonal.desc")}>
          <Switch checked={a.seasonal} onChange={(seasonal) => set({ seasonal })} label={t("ap.seasonal")} />
        </SettingRow>
        <SettingRow
          title={
            <span className="flex items-center gap-2">
              {t("ap.design")}
              <Tag className="h-5 px-1.5 text-[10.5px]">Beta</Tag>
            </span>
          }
          description={t("ap.design.desc")}
        >
          <Switch checked={a.design === "v2"} onChange={(on) => set({ design: on ? "v2" : "v1" })} label={t("ap.design")} />
        </SettingRow>
      </SettingsCard>

      <CustomThemesCard a={a} set={(p) => set(p)} />

      {theme.extras.length > 0 && (
        <SettingsCard title={t("ap.section.extras", { name: t(`ap.theme.${theme.id}`) })}>
          {theme.extras.includes("snow") && (
            <>
              <SettingRow title={t("ap.fx.snow")} description={t("ap.fx.snow.desc")}>
                <Switch checked={a.effects.snow} onChange={(snow) => setFx({ snow })} label={t("ap.fx.snow")} />
              </SettingRow>
              <SettingRow title={t("ap.fx.snow_amount")} className={cn(!a.effects.snow && "opacity-50")}>
                <SliderValue value={a.effects.snow_amount} min={10} max={100} step={5} unit="%" disabled={!a.effects.snow} onChange={(snow_amount) => setFx({ snow_amount }, 300)} />
              </SettingRow>
              <SettingRow title={t("ap.fx.snow_settle")} description={t("ap.fx.snow_settle.desc")} className={cn(!a.effects.snow && "opacity-50")}>
                <Switch checked={a.effects.snow_settle} disabled={!a.effects.snow} onChange={(snow_settle) => setFx({ snow_settle })} label={t("ap.fx.snow_settle")} />
              </SettingRow>
            </>
          )}
          {theme.extras.includes("mascot") && (
            <SettingRow title={t("ap.fx.mascot")} description={t("ap.fx.mascot.desc")}>
              <Switch checked={a.effects.mascot} onChange={(mascot) => setFx({ mascot })} label={t("ap.fx.mascot")} />
            </SettingRow>
          )}
          {theme.extras.includes("frost") && (
            <SettingRow title={t("ap.fx.frost")} description={t("ap.fx.frost.desc")}>
              <Switch checked={a.effects.frost} onChange={(frost) => setFx({ frost })} label={t("ap.fx.frost")} />
            </SettingRow>
          )}
        </SettingsCard>
      )}

      {/* ---------------------------------------------------------- Farbe */}
      <SettingsCard title={t("ap.section.color")}>
        <SettingRow title={t("ap.accent")} description={t("ap.accent.desc")} stacked>
          <AccentPicker value={a.accent} onChange={(accent, d) => set({ accent }, d)} />
        </SettingRow>
          <>
        <SettingRow title={t("ap.tone")} description={t("ap.tone.desc")}>
          <Segmented
            value={a.tone}
            onChange={(tone) => set({ tone })}
            items={(["light", "dark", "dim", "oled"] as const).map((v) => ({ value: v, label: t(`ap.tone.${v}`) }))}
          />
        </SettingRow>
        <SettingRow title={t("ap.contrast")} description={t("ap.contrast.desc")}>
          <Segmented
            value={a.contrast}
            onChange={(contrast) => set({ contrast })}
            items={(["normal", "high"] as const).map((v) => ({ value: v, label: t(`ap.contrast.${v}`) }))}
          />
        </SettingRow>
        <SettingRow title={t("ap.status")} description={t("ap.status.desc")}>
          <div className="flex items-center gap-2">
            {(["ok", "warn", "danger"] as const).map((k) => (
              <StatusSwatch key={k} label={t(`ap.status.${k}`)} value={a.status[k]} onChange={(v) => set({ status: { ...a.status, [k]: v } }, 250)} />
            ))}
            <Tooltip content={t("ap.status.from_accent")}>
              <IconButton
                label={t("ap.status.from_accent")}
                size="sm"
                variant="ghost"
                onClick={() => set({ status: { ...a.status, ok: a.accent } })}
              >
                <Pipette size={14} />
              </IconButton>
            </Tooltip>
          </div>
        </SettingRow>
          </>
      </SettingsCard>

        <>
      {/* ---------------------------------------------------------- Schrift */}
      <SettingsCard title={t("ap.section.font")}>
        <SettingRow title={t("ap.font")} description={t("ap.font.desc")}>
          <Segmented
            value={a.font}
            onChange={(font) => set({ font })}
            items={[
              { value: "inter", label: <span style={{ fontFamily: "Inter" }}>Inter</span> },
              { value: "inter_tight", label: <span style={{ fontFamily: "'Inter Tight Variable'" }}>Inter Tight</span> },
              { value: "system", label: <span style={{ fontFamily: "system-ui, 'Segoe UI'" }}>{t("ap.font.system")}</span> },
              { value: "mono", label: <span style={{ fontFamily: "'JetBrains Mono'" }}>Mono</span> },
            ]}
          />
        </SettingRow>
        <SettingRow title={t("ap.headings")} description={t("ap.headings.desc")}>
          <Segmented
            value={a.headings}
            onChange={(headings) => set({ headings })}
            items={[
              { value: "default", label: t("ap.headings.default") },
              { value: "pixel", label: <span style={{ fontFamily: "Silkscreen", fontWeight: 400, fontSize: 12 }}>PIXEL</span> },
              { value: "pixel_all", label: t("ap.headings.pixel_all") },
            ]}
          />
        </SettingRow>
        <SettingRow title={t("ap.font_scale")} description={t("ap.font_scale.desc")}>
          <SliderValue value={a.font_scale} min={90} max={115} step={5} unit="%" onChange={(font_scale) => set({ font_scale }, 300)} />
        </SettingRow>
      </SettingsCard>

      {/* ---------------------------------------------------------- Form & Dichte */}
      <SettingsCard title={t("ap.section.shape")}>
        <SettingRow
          title={t("ap.radius")}
          description={a.cards === "pixel" ? t("ap.radius.pixel_hint") : t("ap.radius.desc")}
          className={cn(a.cards === "pixel" && "opacity-50")}
        >
          <Segmented
            value={a.radius}
            onChange={(radius) => set({ radius })}
            items={(["square", "slight", "round", "custom"] as const).map((v) => ({
              value: v,
              label: (
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-3 w-3 border-[1.5px] border-current opacity-80"
                    style={{ borderRadius: v === "square" ? 0 : v === "slight" ? 2 : v === "round" ? 4.5 : Math.min(6, a.radius_px / 3) }}
                  />
                  {t(`ap.radius.${v}`)}
                </span>
              ),
            }))}
          />
        </SettingRow>
        {a.radius === "custom" && a.cards !== "pixel" && (
          <SettingRow title={t("ap.radius_px")} description={t("ap.radius_px.desc")}>
            <SliderValue value={a.radius_px} min={0} max={24} step={1} unit="px" onChange={(radius_px) => set({ radius_px }, 200)} />
          </SettingRow>
        )}
        <SettingRow title={t("ap.cards")} description={t("ap.cards.desc")}>
          <Segmented
            value={a.cards}
            onChange={(cards) => set({ cards })}
            items={(["flat", "outlined", "raised", "pixel"] as const).map((v) => ({
              value: v,
              label: (
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "h-3 w-3.5 bg-white/15",
                      v === "outlined" && "shadow-[inset_0_0_0_1.5px_currentColor]",
                      v === "raised" && "shadow-[0_2px_4px_rgb(0_0_0/0.5)]",
                      v === "pixel" && "shadow-[inset_0_0_0_2px_currentColor,0_2px_0_currentColor]",
                    )}
                  />
                  {t(`ap.cards.${v}`)}
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

      {/* ---------------------------------------------------------- Seitenleiste */}
      <SettingsCard
        title={t("ap.section.sidebar")}
        right={
          <Button
            size="sm"
            variant="subtle"
            icon={<RotateCcw size={13} />}
            disabled={JSON.stringify(a.sidebar) === JSON.stringify(DEFAULT_APPEARANCE.sidebar)}
            onClick={() => set({ sidebar: DEFAULT_APPEARANCE.sidebar })}
          >
            {t("ap.reset")}
          </Button>
        }
      >
        <SettingRow title={t("ap.sidebar.mode")} description={t("ap.sidebar.mode.desc")}>
          <Segmented
            value={a.sidebar.mode}
            onChange={(mode) => setSidebar({ mode })}
            items={(["compact", "wide"] as const).map((v) => ({ value: v, label: t(`ap.sidebar.${v}`) }))}
          />
        </SettingRow>
        <SettingRow title={t("ap.sidebar.style")} description={t("ap.sidebar.style.desc")}>
          <Segmented
            value={a.sidebar.style}
            onChange={(style) => setSidebar({ style })}
            items={(["solid", "floating", "tinted"] as const).map((v) => ({ value: v, label: t(`ap.sidebar.style.${v}`) }))}
          />
        </SettingRow>
        <SettingRow title={t("ap.sidebar.instances")} description={t("ap.sidebar.instances.desc")}>
          <Switch checked={a.sidebar.instances} onChange={(instances) => setSidebar({ instances })} label={t("ap.sidebar.instances")} />
        </SettingRow>
        <SettingRow title={t("ap.sidebar.order")} description={t("ap.sidebar.order.desc")} stacked>
          <div className="flex flex-col gap-px overflow-hidden rounded-ctl" role="list">
            {a.sidebar.order.map((k, i) => {
              const hidden = a.sidebar.hidden.includes(k);
              return (
                <div key={k} role="listitem" className="flex h-10 items-center gap-3 bg-white/[.03] px-3">
                  <span className={cn("text-muted", hidden && "opacity-40")}>{NAV_ICONS[k]}</span>
                  <span className={cn("flex-1 text-[13px] font-medium", hidden ? "text-dim line-through decoration-white/20" : "text-text")}>{t(`nav.${k}`)}</span>
                  <IconButton label={t("ap.sidebar.up")} size="sm" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => moveNav(k, -1)}>
                    <ChevronUp size={15} />
                  </IconButton>
                  <IconButton
                    label={t("ap.sidebar.down")}
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={i === a.sidebar.order.length - 1}
                    onClick={() => moveNav(k, 1)}
                  >
                    <ChevronDown size={15} />
                  </IconButton>
                  <IconButton
                    label={hidden ? t("ap.sidebar.show") : t("ap.sidebar.hide")}
                    tip
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={k === "home"}
                    onClick={() => toggleNav(k)}
                  >
                    {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </IconButton>
                </div>
              );
            })}
          </div>
        </SettingRow>
      </SettingsCard>

      {/* ---------------------------------------------------------- Bibliothek */}
      <SettingsCard title={t("ap.section.library")}>
        <SettingRow title={t("ap.icon_size")} description={t("ap.icon_size.desc")}>
          <Segmented
            value={a.icon_size}
            onChange={(icon_size) => set({ icon_size })}
            items={(["large", "small"] as const).map((v) => ({ value: v, label: t(`ap.icon_size.${v}`) }))}
          />
        </SettingRow>
        <SettingRow title={t("ap.library_view")} description={t("ap.library_view.desc")}>
          <Segmented
            value={a.library_view}
            onChange={(library_view) => {
              // sofort übernehmen (die Bibliothek merkt sich sonst die zuletzt umgeschaltete Ansicht)
              try {
                localStorage.setItem("vl.inst.view", JSON.stringify(library_view));
              } catch {
                /* egal */
              }
              set({ library_view });
            }}
            items={[
              { value: "grid", label: <span className="flex items-center gap-1.5"><LayoutGrid size={13} />{t("ap.library_view.grid")}</span> },
              { value: "list", label: <span className="flex items-center gap-1.5"><List size={13} />{t("ap.library_view.list")}</span> },
            ]}
          />
        </SettingRow>
      </SettingsCard>

        </>

      {/* ---------------------------------------------------------- Bewegung */}
      <SettingsCard title={t("ap.section.motion")}>
        <SettingRow title={t("ap.motion")} description={t(`ap.motion.${motion}.desc`)}>
          <Segmented
            value={motion}
            onChange={(v) => {
              const reduce_motion = v === "reduced";
              document.documentElement.dataset.reduceMotion = String(reduce_motion);
              update({ reduce_motion, appearance: { ...a, motion: v === "more" ? "more" : v === "normal" ? "normal" : a.motion } });
            }}
            items={(["reduced", "normal", "more"] as const).map((v) => ({ value: v, label: t(`ap.motion.${v}`) }))}
          />
        </SettingRow>
          <SettingRow title={t("ap.nav_animations")} description={t("ap.nav_animations.desc")} className={cn(motion === "reduced" && "opacity-50")}>
            <Switch checked={a.nav_animations} disabled={motion === "reduced"} onChange={(nav_animations) => set({ nav_animations })} label={t("ap.nav_animations")} />
          </SettingRow>
      </SettingsCard>

        <>
      {/* ---------------------------------------------------------- Hintergrund */}
      <SettingsCard title={t("ap.section.background")}>
        <SettingRow title={t("ap.bg.kind")} description={`${t("ap.bg.kind.desc")} ${t("ap.paused_hint")}`} stacked>
          <div className="flex flex-col gap-3">
            <Segmented<BackgroundKind>
              value={b.kind}
              onChange={(kind) => setBg({ kind })}
              items={(["none", "color", "gradient", "image", "animated"] as const).map((v) => ({ value: v, label: t(`ap.bg.${v}`) }))}
            />
            {b.kind === "color" && <SolidColorEditor b={b} setBg={setBg} />}
            {b.kind === "gradient" && (
              <div className="flex flex-wrap gap-2">
                {GRADIENT_KEYS.map((g) => (
                  <PresetTile key={g} label={t(`ap.grad.${g}`)} active={b.gradient === g} onClick={() => setBg({ gradient: g })}>
                    <span className="absolute inset-0" style={{ background: GRADIENTS[g](a.accent), imageRendering: g === "pixel" ? "pixelated" : undefined }} />
                  </PresetTile>
                ))}
                <PresetTile label={t("ap.grad.custom")} active={b.gradient === "custom"} onClick={() => setBg({ gradient: "custom" })}>
                  <span className="absolute inset-0" style={{ background: `linear-gradient(${b.gradient_angle}deg, ${b.gradient_from}, ${b.gradient_to})` }} />
                </PresetTile>
              </div>
            )}
            {b.kind === "gradient" && b.gradient === "custom" && <GradientEditor b={b} setBg={setBg} />}
            {b.kind === "image" && (
              <FilePick slot="image" path={b.image} onPicked={(image) => setBg({ image, kind: "image" })} onRemove={() => setBg({ image: null, kind: "none" })} />
            )}
            {b.kind === "animated" && (
              <>
                <div className="flex flex-wrap gap-2">
                  {ANIMATED.map(({ key, icon }) => (
                    <PresetTile key={key} label={t(`ap.anim.${key}`)} active={b.animated === key} onClick={() => setBg({ animated: key })}>
                      <span className="absolute inset-0 grid place-items-center bg-white/[.05] text-muted">{icon}</span>
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
        <SettingRow
          title={t("ap.glass")}
          description={b.kind === "none" ? t("ap.glass.needs_bg") : a.cards === "pixel" ? t("ap.glass.pixel_hint") : t("ap.glass.desc")}
          className={cn(b.kind === "none" && "opacity-50")}
        >
          <SliderValue value={a.glass} min={0} max={100} step={5} unit="%" disabled={b.kind === "none"} onChange={(glass) => set({ glass }, 250)} />
        </SettingRow>
      </SettingsCard>

      <AppIconCard a={a} set={set} />

      <SettingsCard title={t("ap.section.more")}>
        <SettingRow title={t("settings.minecraftcapes")} description={t("settings.minecraftcapes.desc")}>
          <Switch checked={s.minecraftcapes} onChange={(minecraftcapes) => update({ minecraftcapes })} label={t("settings.minecraftcapes")} />
        </SettingRow>
      </SettingsCard>
        </>
    </>
  );
}

// ------------------------------------------------------------------ Bausteine

/** App-Icon: Motiv (Robbe, Pinguin, eigenes Bild), Kachelfarbe und Live-Vorschau. */
function AppIconCard({ a, set }: { a: Appearance; set: (p: Partial<Appearance>, delay?: number) => void }) {
  const t = useT();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .appIconPreview(a.app_icon, a.app_icon_color, a.app_icon_image, 128)
      .then((u) => alive && setPreview(u))
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [a.app_icon, a.app_icon_color, a.app_icon_image]);
  const pick = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({ multiple: false, directory: false, filters: [{ name: t("ap.app_icon.filter"), extensions: ["png", "jpg", "jpeg"] }] });
    if (typeof file !== "string") return;
    setBusy(true);
    try {
      set({ app_icon: "custom", app_icon_image: await api.appIconImport(file) });
    } catch (e) {
      toast.error(e, t("ap.app_icon.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsCard title={t("ap.app_icon")}>
      {/* Vorschau in groß und in den echten Taskleisten-Größen, daneben die Motivwahl */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
        <div className="flex shrink-0 items-end gap-3">
          <span className="grid h-[72px] w-[72px] place-items-center rounded-card bg-field">
            {preview ? <img src={preview} alt={t("ap.app_icon")} className="h-14 w-14 [image-rendering:pixelated]" /> : <span className="h-14 w-14 rounded-ctl bg-surface2" />}
          </span>
          <span className="flex items-end gap-2 pb-0.5" aria-hidden>
            {preview
              ? [32, 24, 16].map((px) => <img key={px} src={preview} alt="" style={{ width: px, height: px }} className="[image-rendering:pixelated]" />)
              : [32, 24, 16].map((px) => <span key={px} style={{ width: px, height: px }} className="rounded-xs bg-surface2" />)}
          </span>
        </div>
        <p className="min-w-[220px] flex-1 text-[12.5px] leading-relaxed text-muted">{t("ap.app_icon.desc")}</p>
        <Segmented
          value={a.app_icon}
          onChange={(app_icon) => (app_icon === "custom" && !a.app_icon_image ? void pick() : set({ app_icon }))}
          items={[
            { value: "seal", label: t("ap.app_icon.seal") },
            { value: "penguin", label: t("ap.app_icon.penguin") },
            { value: "custom", label: t("ap.app_icon.custom") },
          ]}
        />
      </div>
      {a.app_icon === "custom" && (
        <SettingRow className="border-t" title={t("ap.app_icon.custom")} description={t("ap.app_icon.custom_hint")}>
          <Button size="sm" onClick={pick} loading={busy}>
            {a.app_icon_image ? t("ap.app_icon.change") : t("ap.app_icon.choose")}
          </Button>
        </SettingRow>
      )}
      <SettingRow className="border-t" title={t("ap.app_icon.color")} description={t("ap.app_icon.color.desc")} stacked>
        <AccentPicker value={a.app_icon_color} onChange={(app_icon_color, d) => set({ app_icon_color }, d)} />
      </SettingRow>
    </SettingsCard>
  );
}

/**
 * Live-Vorschau: verkleinerter Launcher (Rahmen, Seitenleiste, Bühne, Kacheln). Liest dieselben CSS-Variablen wie
 * die App (der Entwurf ist global angewendet) und zeigt Theme-Extras: Schneefall, Robbe mit Schal, Frost.
 */
function MiniPreview({ a }: { a: Appearance }) {
  const t = useT();
  const snow = themeExtra(a, "snow");
  const mascot = themeExtra(a, "mascot");
  const frost = themeExtra(a, "frost");
  const wide = a.sidebar.mode === "wide";
  return (
    <div className="relative h-[180px] w-[320px] shrink-0 overflow-hidden rounded-card bg-[var(--tone-frame)] shadow-[0_0_0_1px_var(--line-2)]" aria-label={t("ap.preview")}>
      <Backdrop appearance={a} contained />
      <div className="absolute inset-0 flex">
        <div
          className={cn(
            "flex shrink-0 flex-col gap-1.5 bg-bg pt-2",
            wide ? "w-[72px] items-stretch px-1.5" : "w-8 items-center",
            a.sidebar.style === "floating" && "my-1.5 ml-1.5 rounded-card bg-panel shadow-[0_0_0_1px_var(--line-1)]",
          )}
          style={a.sidebar.style === "tinted" ? { background: "color-mix(in srgb, var(--ui-accent) 11%, var(--frame))" } : undefined}
        >
          {mascot ? (
            <img src="/logo-seal-winter.png" alt="" className="h-5 w-5 self-center object-contain [image-rendering:pixelated]" />
          ) : (
            <span className="h-4 w-4 self-center rounded-xs bg-brand/80" />
          )}
          {a.sidebar.order
            .filter((k) => !a.sidebar.hidden.includes(k))
            .slice(0, 5)
            .map((k, i) => (
              <span key={k} className="flex items-center gap-1">
                <span className={cn("h-3.5 w-3.5 shrink-0 rounded-xs", i === 0 ? "bg-brand/70" : "bg-white/10")} />
                {wide && <span className="h-1.5 flex-1 rounded-xs bg-white/15" />}
              </span>
            ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={cn("bg-bg", a.design === "v2" ? "h-6" : "h-5")} />
          <div
            className={cn(
              "flex flex-1 flex-col gap-2 bg-panel p-2.5",
              a.design === "v2" ? "mb-1.5 mr-1.5 rounded-card shadow-[0_0_0_1px_var(--line-1),0_4px_14px_rgb(0_0_0/0.25)]" : "rounded-tl-card",
            )}
          >
            <div className="relative flex items-center gap-2 overflow-hidden rounded-card bg-surface p-2">
              <span className="h-7 w-7 rounded-ctl bg-surface3" />
              <span className="flex flex-1 flex-col gap-1">
                <span className="h-2 w-20 rounded-xs bg-[var(--text-1)]" style={a.headings === "pixel" ? { borderRadius: 0, height: 7 } : undefined} />
                <span className="h-1.5 w-14 rounded-xs bg-[var(--text-3)]" />
              </span>
              <span className="h-5 w-12 rounded-ctl bg-brand" />
            </div>
            <div className={cn("grid gap-1.5", a.icon_size === "small" ? "grid-cols-5" : "grid-cols-4")}>
              {[0, 1, 2, 3, 4].slice(0, a.icon_size === "small" ? 5 : 4).map((i) => (
                <span key={i} className="flex flex-col gap-1">
                  <span className="aspect-[4/3] rounded-ctl bg-surface" />
                  <span className="h-1.5 w-3/4 rounded-xs bg-white/30" />
                </span>
              ))}
            </div>
            <div className="mt-auto flex items-center gap-1.5">
              <span className="h-4 w-14 rounded-ctl bg-surface2" />
              <span className="h-4 w-10 rounded-ctl bg-field" />
              <span className="ml-auto flex gap-1">
                <span className="h-2 w-2 rounded-dot bg-ok" />
                <span className="h-2 w-2 rounded-dot bg-warn" />
                <span className="h-2 w-2 rounded-dot bg-danger" />
              </span>
            </div>
          </div>
        </div>
      </div>
      {/* Mini-Dialog mit Frost oben rechts */}
      {frost && (
        <div className="absolute right-3 top-8 h-10 w-24 rounded-panel bg-overlay shadow-e3">
          <span
            className="absolute inset-0 opacity-70 [image-rendering:pixelated]"
            style={{ background: "var(--frost-l) left top / 60px 36px no-repeat, var(--frost-r) right top / 60px 36px no-repeat" }}
          />
          <span className="absolute left-2 top-2.5 h-1.5 w-10 rounded-xs bg-white/60" />
          <span className="absolute left-2 top-5 h-1 w-14 rounded-xs bg-white/20" />
        </div>
      )}
      {snow && <Snowfall contained amount={a.effects.snow_amount} settle={false} />}
    </div>
  );
}

/** Theme-Kachel: kleine, statische Launcher-Skizze in den Farben des Themes. */
function ThemeTile({ id, active, modified, onClick }: { id: ThemeId; active: boolean; modified: boolean; onClick: () => void }) {
  const t = useT();
  const th = THEMES[id];
  const sw = th.swatch;
  const ac = th.tokens.accent;
  const r = { square: 0, slight: 2, round: 4, custom: 3 }[th.tokens.radius];
  const light = th.tokens.tone === "light";
  const px = th.tokens.cards === "pixel";
  const edge =
    th.tokens.cards === "outlined" || light || px
      ? `inset 0 0 0 ${px ? 1.5 : 1}px ${light ? "rgb(10 12 18 / .14)" : "rgb(255 255 255 / .16)"}`
      : undefined;
  return (
    <button onClick={onClick} aria-pressed={active} className="group flex min-w-0 flex-col gap-1.5 text-left">
      <span
        className={cn(
          "relative block h-[66px] w-full overflow-hidden rounded-card shadow-[0_0_0_1px_var(--line-1)]",
          active ? "outline outline-2 outline-offset-2 outline-brand" : "group-hover:outline group-hover:outline-1 group-hover:outline-offset-2 group-hover:outline-white/25",
        )}
        style={{ background: sw.frame }}
      >
        <span className="absolute inset-y-0 left-0 flex w-4 flex-col items-center gap-1 pt-1.5">
          <span className="h-2 w-2" style={{ background: ac, borderRadius: r / 2 }} />
          <span className="h-2 w-2" style={{ background: sw.surface2, borderRadius: r / 2 }} />
          <span className="h-2 w-2" style={{ background: sw.surface2, borderRadius: r / 2 }} />
        </span>
        <span className="absolute bottom-0 left-4 right-0 top-2.5 flex flex-col gap-1 p-1.5" style={{ background: sw.canvas, borderTopLeftRadius: r }}>
          <span className="flex items-center gap-1 p-1" style={{ background: sw.surface, borderRadius: r, boxShadow: edge }}>
            <span
              className={th.tokens.headings === "pixel" ? "h-2 w-8" : "h-1.5 w-8"}
              style={{ background: sw.text, opacity: 0.85, borderRadius: th.tokens.headings === "pixel" ? 0 : r / 3 }}
            />
            <span className="ml-auto h-2.5 w-5" style={{ background: ac, borderRadius: r / 2, boxShadow: px ? "inset 0 -2px 0 rgb(0 0 0 / .3)" : undefined }} />
          </span>
          <span className="grid grid-cols-3 gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-3" style={{ background: sw.surface, borderRadius: r, boxShadow: edge }} />
            ))}
          </span>
          <span className="flex items-center gap-[3px]">
            <span className="h-1 w-6" style={{ background: sw.muted, opacity: 0.7, borderRadius: r / 3 }} />
            <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: th.tokens.status.ok }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: th.tokens.status.warn }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: th.tokens.status.danger }} />
          </span>
        </span>
        {th.tokens.cards === "pixel" && (
          <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-[14px] w-full" viewBox="0 0 60 7" preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden>
            <path d="M0 7V4h4V3h5v1h4V2h6v2h5V3h6V1h5v2h4v1h6V2h5v2h5v3z" fill={id === "pixel" ? "#2a1846" : "#d9d4ea"} />
          </svg>
        )}
        {id === "winter" && (
          // ein paar ruhende Flocken + Schneekante auf der Inhaltsfläche
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 120 66" preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden>
            <g fill="#eaf4ff">
              <rect x="30" y="5" width="1.5" height="1.5" opacity=".7" />
              <rect x="58" y="14" width="1" height="1" opacity=".5" />
              <rect x="84" y="4" width="2" height="2" opacity=".8" />
              <rect x="101" y="20" width="1" height="1" opacity=".5" />
              <rect x="70" y="36" width="1.5" height="1.5" opacity=".6" />
              <rect x="44" y="50" width="1" height="1" opacity=".5" />
              <rect x="110" y="44" width="1.5" height="1.5" opacity=".6" />
              <rect x="22" y="8" width="18" height="1" opacity=".55" />
              <rect x="48" y="8.5" width="26" height=".75" opacity=".4" />
              <rect x="90" y="8" width="14" height="1" opacity=".5" />
            </g>
          </svg>
        )}
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn("truncate text-[12.5px] font-medium", active ? "text-text" : "text-muted group-hover:text-text")}>{t(`ap.theme.${id}`)}</span>
        {id === "winter" && <Snowflake size={11} className="shrink-0 text-dim" />}
        {modified && <span className="ml-auto shrink-0 text-[11px] text-dim">{t("ap.theme.modified")}</span>}
      </span>
    </button>
  );
}

/** Farbfeld mit Farbwähler (Statusfarben). */
function StatusSwatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Tooltip content={label}>
      <label className="relative grid h-8 w-8 cursor-pointer place-items-center rounded-ctl" style={{ background: value }}>
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </Tooltip>
  );
}

function AccentPicker({ value, onChange }: { value: string; onChange: (v: string, delay?: number) => void }) {
  const t = useT();
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const presets = [...ACCENT_PRESETS, ...THEME_IDS.map((id) => THEMES[id].tokens.accent).filter((c) => !ACCENT_PRESETS.includes(c))];
  const custom = !presets.includes(value.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((c) => {
        const active = c === value.toLowerCase();
        return (
          <button
            key={c}
            aria-label={c}
            aria-pressed={active}
            onClick={() => onChange(c)}
            className={cn("grid h-8 w-8 place-items-center rounded-ctl transition-transform duration-100 hover:scale-105", active && "outline outline-2 outline-offset-2 outline-white/80")}
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
          <input type="color" aria-label={t("ap.accent.custom")} value={value} onChange={(e) => onChange(e.target.value, 250)} className="absolute inset-0 cursor-pointer opacity-0" />
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
        <AnimatedNumber value={value} />
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
