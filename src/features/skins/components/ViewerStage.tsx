import { RotateCw } from "lucide-react";
import { lazy, Suspense } from "react";
import { ErrorState, IconButton, Segmented, Spinner } from "@/components/ui";
import { useT } from "@/i18n";
import type { SkinsPageState } from "../hooks/useSkinsPage";
import { CenterSpinner, NoAccount } from "./ViewerStates";

const SkinViewer3D = lazy(() => import("../SkinViewer3D"));

export function ViewerStage({ c }: { c: SkinsPageState }) {
  const t = useT();
  const { viewerSkin, viewerVariant, shownCape, anim, setAnim, rotate, setRotate, mcShown, mcFrames, mcProfile, account, setMsa, profileQ, busy } = c;
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {viewerSkin ? (
        <Suspense fallback={<CenterSpinner />}>
          <SkinViewer3D
            skin={viewerSkin}
            variant={viewerVariant}
            cape={shownCape?.data_url ?? null}
            animation={anim}
            autoRotate={rotate}
            mcCape={mcShown ? mcFrames : null}
            glint={mcShown && !!mcProfile?.glint}
            ears={mcShown ? (mcProfile?.ears?.data_url ?? null) : null}
            upsideDown={mcShown && !!mcProfile?.upside_down}
          />
        </Suspense>
      ) : !account ? (
        <NoAccount onLogin={() => setMsa(true)} />
      ) : account.needs_relogin ? (
        <NoAccount relogin onLogin={() => setMsa(true)} />
      ) : profileQ.isError ? (
        <ErrorState className="h-full" error={profileQ.error} onRetry={() => void profileQ.refetch()} />
      ) : (
        <CenterSpinner />
      )}
      {busy && (
        <div className="absolute inset-0 grid place-items-center bg-black/40">
          <Spinner size={22} />
        </div>
      )}
      {viewerSkin && (
        <div className="absolute left-3 top-2">
          <Segmented
            value={anim}
            onChange={setAnim}
            items={[
              { value: "idle", label: t("skins.anim_idle") },
              { value: "walk", label: t("skins.anim_walk") },
            ]}
          />
        </div>
      )}
      {viewerSkin && (
        <div className="absolute bottom-2 left-3 right-2 flex items-center justify-between gap-2">
          <span className="text-caption text-dim">{t("skins.drag_hint")}</span>
          <IconButton label={t("skins.rotate")} tip tipSide="left" variant="ghost" size="sm" active={rotate} onClick={() => setRotate((r) => !r)}>
            <RotateCw size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
