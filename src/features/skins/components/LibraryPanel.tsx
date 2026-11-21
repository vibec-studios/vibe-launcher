import { Sparkles } from "lucide-react";
import { EmptyState, ErrorState, Skeleton, Tabs, cn } from "@/components/ui";
import { t as tt } from "@/i18n";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import type { SkinsPageState } from "../hooks/useSkinsPage";
import { McCapesOptIn } from "../McCapesOptIn";
import { McCapesPanel } from "../McCapesPanel";
import { SkinImportButton } from "../SkinImport";
import { AddFileButton } from "./AddSkinControls";
import { LibraryTile } from "./LibraryTile";

export function LibraryPanel({ c }: { c: SkinsPageState }) {
  const t = useT();
  const { dragOver, account, tab, setTab, libraryQ, libraryTab, mcEnabled, mcQ, mcFrames, mcShown, setMcShown, preview, setPreview, profile, busy, accountId, mutate, setRenaming, openEditor } = c;
  return (
    <section data-tour="skins-library" className={cn("relative flex min-h-0 flex-col rounded-card", dragOver && "outline outline-2 outline-accent")}>
      {account ? (
        <Tabs
          className="h-9! shrink-0 border-b-0"
          value={tab}
          onChange={setTab}
          items={[
            { value: "library", label: t("skins.library"), badge: libraryQ.data?.length },
            { value: "mccapes", label: t("mccapes.title"), icon: <Sparkles size={14} /> },
          ]}
          right={libraryTab ? <SkinImportButton /> : undefined}
        />
      ) : (
        <div className="flex h-9 shrink-0 items-center gap-2 px-1">
          <span className="text-section text-text">{t("skins.library")}</span>
          {libraryQ.data && <span className="text-meta text-dim">{t("skins.library_count", { n: libraryQ.data.length })}</span>}
          <div className="ml-auto">
            <SkinImportButton />
          </div>
        </div>
      )}
      {!libraryTab ? (
        mcEnabled ? (
          <McCapesPanel profileQ={mcQ} frames={mcFrames} shown={mcShown} onShownChange={setMcShown} />
        ) : (
          <McCapesOptIn />
        )
      ) : (
        <div className="scroll relative min-h-0 flex-1 p-0.5 pt-2">
          {libraryQ.isPending ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-[158px]" />
              ))}
            </div>
          ) : libraryQ.isError ? (
            <ErrorState error={libraryQ.error} onRetry={() => void libraryQ.refetch()} />
          ) : libraryQ.data.length === 0 ? (
            <EmptyState className="h-full" icon="shirt" title={t("skins.library_empty_title")} text={t("skins.library_empty_text")} action={<AddFileButton />} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
              {libraryQ.data.map((s) => (
                <LibraryTile
                  key={s.id}
                  skin={s}
                  selected={preview?.skin?.id === s.id}
                  canApply={!!profile && !busy}
                  onPreview={() => setPreview((p) => ({ capeId: p?.capeId, skin: s, variant: s.variant }))}
                  onApply={() => {
                    if (!accountId) return;
                    void mutate("apply", () => api.skinApplyLibrary(accountId, s.id, null), tt("skins.applied"), tt("skins.error.apply")).then(
                      (ok) => ok && setPreview(null),
                    );
                  }}
                  onRename={() => setRenaming(s)}
                  onEdit={() => openEditor({ dataUrl: s.data_url, name: s.name, variant: s.variant })}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-card bg-overlay/90 text-[14px] font-semibold text-text">{t("skins.drop_here")}</div>
      )}
    </section>
  );
}
