// Große, drehbare 3D-Vorschau: eigener Skin + Loadout + Emote (vibey3d.ts). Ziehen dreht, Mausrad zoomt.
import { useQuery } from "@tanstack/react-query";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Footprints, PersonStanding, RotateCcw, Rotate3d, Wind } from "lucide-react";
import { api } from "@/lib/api";
import { useAccounts } from "@/lib/queries";
import { IconButton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { createWardrobeViewer, type Bundle, type Mode, type ViewSide, type WardrobeViewer } from "./vibey3d";

/** Skin des aktiven Accounts (data:-URL über Rust, gleiche Abfrage wie die Skins-Seite). */
export function useOwnSkin() {
  const accounts = useAccounts().data ?? [];
  const acc = accounts.find((a) => a.active) ?? accounts[0] ?? null;
  const q = useQuery({
    queryKey: ["skins-profile", acc?.id ?? "-"],
    queryFn: () => api.skinsProfile(acc!.id),
    enabled: !!acc && !acc.needs_relogin,
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Fallback: Skin-URL des Accounts (textures.minecraft.net erlaubt CORS); Modell dann unbekannt -> Classic
  const fallback = acc?.skin_url ? acc.skin_url.replace(/^http:\/\//, "https://") : null;
  return { src: q.data?.skin?.data_url ?? fallback, slim: q.data?.skin?.variant === "slim", ready: !acc || !q.isLoading, name: acc?.username ?? null };
}

export interface Viewer3DHandle {
  snapshot: (size?: number) => string | null;
  view: (side: ViewSide) => void;
}

export interface Viewer3DProps {
  bundles: Bundle[];
  emote: Bundle | null;
  /** Ansicht, auf die bei Änderung gedreht wird (z. B. Rücken bei Umhängen) */
  focus?: ViewSide | null;
  /** Ändert sich der Schlüssel, wird erneut auf `focus` gedreht */
  focusKey?: string;
  controls?: boolean;
  className?: string;
  /** Eigenen Skin verwenden (sonst neutraler Spieler) */
  skin?: { src: string | null; slim: boolean };
}

const reduceMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const Viewer3D = forwardRef<Viewer3DHandle, Viewer3DProps>(function Viewer3D({ bundles, emote, focus, focusKey, controls = true, className, skin }, ref) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<WardrobeViewer | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [auto, setAuto] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    try {
      viewer.current = createWardrobeViewer(canvas.current, { reduceMotion });
    } catch {
      setFailed(true);
    }
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    snapshot: (size) => viewer.current?.snapshot(size) ?? null,
    view: (side) => viewer.current?.view(side),
  }));

  const skinSrc = skin?.src ?? null;
  const slim = !!skin?.slim;
  useEffect(() => {
    void viewer.current?.setSkin(skinSrc, slim);
  }, [skinSrc, slim]);
  useEffect(() => viewer.current?.setItems(bundles), [bundles]);
  useEffect(() => viewer.current?.playEmote(emote), [emote]);
  useEffect(() => viewer.current?.setMode(mode), [mode]);
  useEffect(() => viewer.current?.setAutoRotate(auto), [auto]);
  useEffect(() => {
    if (focus) viewer.current?.view(focus);
  }, [focus, focusKey]);

  return (
    <div className={cn("relative min-h-0 overflow-hidden", className)}>
      <canvas ref={canvas} className="block h-full w-full cursor-grab touch-none active:cursor-grabbing" />
      {failed && <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-muted">{t("cos.viewer.failed")}</div>}
      {controls && (
        <>
          <div className="absolute left-2 top-2 flex gap-0.5">
            {(["front", "side", "back"] as ViewSide[]).map((s) => (
              <button
                key={s}
                onClick={() => viewer.current?.view(s)}
                className="h-8 rounded-ctl px-2.5 text-[12px] font-semibold text-muted transition-colors hover:bg-white/[.07] hover:text-text"
              >
                {t(`cos.view.${s}`)}
              </button>
            ))}
          </div>
          <div className="absolute right-2 top-2 flex gap-0.5">
            <IconButton label={t("cos.mode.idle")} tip variant="ghost" size="sm" active={mode === "idle"} onClick={() => setMode("idle")}>
              <PersonStanding size={15} />
            </IconButton>
            <IconButton label={t("cos.mode.walk")} tip variant="ghost" size="sm" active={mode === "walk"} onClick={() => setMode("walk")}>
              <Footprints size={15} />
            </IconButton>
            <IconButton label={t("cos.mode.fly")} tip variant="ghost" size="sm" active={mode === "fly"} onClick={() => setMode("fly")}>
              <Wind size={15} />
            </IconButton>
            <span className="w-1.5" />
            <IconButton label={t("cos.view.auto")} tip variant="ghost" size="sm" active={auto} onClick={() => setAuto((a) => !a)}>
              <Rotate3d size={15} />
            </IconButton>
            <IconButton label={t("cos.view.reset")} tip variant="ghost" size="sm" onClick={() => viewer.current?.reset()}>
              <RotateCcw size={15} />
            </IconButton>
          </div>
        </>
      )}
    </div>
  );
});
