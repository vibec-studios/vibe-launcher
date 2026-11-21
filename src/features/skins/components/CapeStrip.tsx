import { Skeleton } from "@/components/ui";
import { useT } from "@/i18n";
import type { SkinsPageState } from "../hooks/useSkinsPage";
import { CapeTile, McTile } from "./CapeTiles";

export function CapeStrip({ c }: { c: SkinsPageState }) {
  const t = useT();
  const { account, profile, mcShown, shownCapeId, activeCape, setMcShown, setPreview, mcHas, mcProfile, mcFrames, mcEnabled, setTab } = c;
  if (!account || account.needs_relogin) return null;
  return (
    <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-3 px-4 pb-4 pt-3">
      <div className="min-w-0">
        <div className="mb-2 text-section text-muted">{t("skins.capes")}</div>
        {!profile ? (
          <div className="flex gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[76px] w-[58px]" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <CapeTile
              label={t("skins.no_cape")}
              selected={!mcShown && shownCapeId === null}
              active={!activeCape}
              onClick={() => {
                setMcShown(false);
                setPreview((p) => ({ ...p, capeId: null }));
              }}
            />
            {profile.capes.map((c) => (
              <CapeTile
                key={c.id}
                cape={c}
                label={c.alias}
                selected={!mcShown && shownCapeId === c.id}
                active={c.state === "ACTIVE"}
                onClick={() => {
                  setMcShown(false);
                  setPreview((p) => ({ ...p, capeId: c.id }));
                }}
              />
            ))}
            {profile.capes.length === 0 && <span className="self-center text-meta text-dim">{t("skins.no_capes")}</span>}
          </div>
        )}
      </div>
      {mcHas && (
        <div className="min-w-0">
          <div className="mb-2 flex items-baseline gap-1.5 text-section text-muted">
            {t("mccapes.title")}
            <span className="font-normal text-dim">· {t("mccapes.strip_hint")}</span>
          </div>
          <McTile
            profile={mcProfile!}
            frames={mcFrames}
            selected={mcShown}
            onClick={() => {
              setMcShown((v) => !v);
              if (mcEnabled) setTab("mccapes");
            }}
          />
        </div>
      )}
    </div>
  );
}
