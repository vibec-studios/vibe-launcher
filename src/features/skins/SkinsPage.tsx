// OWNER: Auth-Agent. Skins & Capes: 3D-Vorschau, aktueller Skin/Cape des Accounts, lokale Skin-Bibliothek.
import { useQuery } from "@tanstack/react-query";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Download,
  FileUp,
  FolderOpen,
  ImagePlus,
  LogIn,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  RotateCw,
  Save,
  Shirt,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  Dialog,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  PageToolbar,
  Segmented,
  Select,
  Skeleton,
  Spinner,
  Tabs,
  Tooltip,
  cn,
  confirm,
  toast,
} from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { api } from "@/lib/api";
import { useEvent } from "@/lib/events";
import { queryClient, useAccounts } from "@/lib/queries";
import type { Cape, LibrarySkin, SkinProfile, SkinVariant } from "@/lib/types";
import { PlayerHead } from "@/components/PlayerHead";
import { registerDropTarget, useDragState } from "@/components/content/dragdrop";
import { MsaDialog } from "@/features/accounts/MsaDialog";
import { useCapeFront, useSkinFront } from "./render";
import type { ViewerAnimation } from "./SkinViewer3D";
import { McCapesOptIn } from "./McCapesOptIn";
import { McCapesPanel, McCapeThumb } from "./McCapesPanel";
import { SkinImportButton, sourceLabels, type ImportSource } from "./SkinImport";
import { useCapeFrames, useMcCapesEnabled, useMcProfile, type McCapeFrames, type McProfile } from "./minecraftcapes";

const SkinViewer3D = lazy(() => import("./SkinViewer3D"));

const DROP_ID = "skins-page";
const skq = {
  profile: (accountId: string) => ["skins-profile", accountId] as const,
  library: ["skin-library"] as const,
};
const isPng = (p: string) => p.toLowerCase().endsWith(".png");

/** Vorschau-Zustand: Skin aus der Bibliothek und/oder ein anderes Cape (undefined = unverändert). */
interface Preview {
  skin?: LibrarySkin;
  variant?: SkinVariant;
  capeId?: string | null;
}

function setProfile(p: SkinProfile) {
  queryClient.setQueryData(skq.profile(p.account_id), p);
}

async function addFiles(paths: string[]) {
  const pngs = paths.filter(isPng);
  let ok = 0;
  for (const p of pngs) {
    try {
      await api.skinLibraryAddFile(p);
      ok++;
    } catch (e) {
      toast.error(e, tt("skins.error.library"));
    }
  }
  if (ok) {
    void queryClient.invalidateQueries({ queryKey: skq.library });
    toast.success(ok === 1 ? tt("skins.added") : tt("skins.added_n", { n: ok }));
  }
}

export function SkinsPage() {
  const t = useT();
  const accountsQ = useAccounts();
  const accounts = accountsQ.data ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const account = accounts.find((a) => a.id === chosen) ?? accounts.find((a) => a.active) ?? accounts[0] ?? null;
  const accountId = account?.id ?? null;
  const [msa, setMsa] = useState(false);

  const profileQ = useQuery({
    queryKey: skq.profile(accountId ?? "-"),
    queryFn: () => api.skinsProfile(accountId),
    enabled: !!accountId && !account?.needs_relogin,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const libraryQ = useQuery({ queryKey: skq.library, queryFn: api.skinLibraryList, staleTime: Infinity });
  const profile = accountId && profileQ.data?.account_id === accountId ? profileQ.data : undefined;

  const [preview, setPreview] = useState<Preview | null>(null);
  const [anim, setAnim] = useState<ViewerAnimation>("idle");
  const [rotate, setRotate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<LibrarySkin | null>(null);
  const [tab, setTab] = useState<"library" | "mccapes">("library");

  // MinecraftCapes (nur wenn in den Einstellungen an – sonst keine Anfrage)
  const mcEnabled = useMcCapesEnabled();
  const mcQ = useMcProfile(accountId, mcEnabled && !!account);
  const mcProfile = mcEnabled && mcQ.data?.account_id === accountId ? mcQ.data : undefined;
  const mcFrames = useCapeFrames(mcProfile?.cape);
  const mcHas = !!mcProfile && (!!mcProfile.cape || !!mcProfile.ears);
  const [mcShownRaw, setMcShown] = useState(false);
  const mcShown = mcShownRaw && mcHas;

  useEffect(() => {
    setPreview(null);
    setMcShown(false);
  }, [accountId]);
  useEvent("skins://changed", (p) => {
    if (p.scope === "library") void queryClient.invalidateQueries({ queryKey: skq.library });
    else if (p.account_id !== accountId) void queryClient.invalidateQueries({ queryKey: skq.profile(p.account_id) });
  });

  // Drag & Drop: PNGs auf der Seite -> Bibliothek
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    return registerDropTarget({ id: DROP_ID, el, accepts: (paths) => paths.some(isPng), onDrop: (paths) => void addFiles(paths) });
  }, []);
  const dragOver = useDragState((s) => s.over === DROP_ID);

  /** Änderung am Profil ausführen (Knopf zeigt Ladezustand über `key`). */
  const mutate = async (key: string, fn: () => Promise<SkinProfile>, success: string, errorTitle: string) => {
    setBusy(key);
    try {
      const p = await fn();
      setProfile(p);
      toast.success(success);
      return true;
    } catch (e) {
      toast.error(e, errorTitle);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const activeCape = profile?.capes.find((c) => c.state === "ACTIVE") ?? null;
  const shownCapeId = preview?.capeId !== undefined ? preview.capeId : (activeCape?.id ?? null);
  const shownCape = profile?.capes.find((c) => c.id === shownCapeId) ?? null;
  const viewerSkin = preview?.skin?.data_url ?? profile?.skin?.data_url ?? null;
  const viewerVariant: SkinVariant = preview?.skin ? (preview.variant ?? preview.skin.variant) : (profile?.skin?.variant ?? "classic");

  const applyPreview = async () => {
    if (!preview || !accountId) return;
    let ok = true;
    if (preview.skin) {
      const s = preview.skin;
      ok = await mutate("apply", () => api.skinApplyLibrary(accountId, s.id, preview.variant ?? s.variant), tt("skins.applied"), tt("skins.error.apply"));
    }
    if (ok && preview.capeId !== undefined && preview.capeId !== (activeCape?.id ?? null)) {
      const cid = preview.capeId;
      ok = await mutate("apply", () => api.capeSet(accountId, cid), cid ? tt("skins.cape_changed") : tt("skins.cape_hidden"), tt("skins.error.cape"));
    }
    if (ok) setPreview(null);
  };

  const changeVariant = (v: SkinVariant) => {
    if (preview?.skin) return setPreview({ ...preview, variant: v });
    if (!accountId || !profile?.skin || profile.skin.variant === v) return;
    void mutate("variant", () => api.skinSetVariant(accountId, v), tt("skins.variant_changed"), tt("skins.error.apply"));
  };

  const uploadFile = async () => {
    if (!accountId) return;
    const path = await openDialog({ multiple: false, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (typeof path !== "string") return;
    const variant = viewerVariant;
    await mutate("upload", () => api.skinUploadFile(accountId, path, variant), tt("skins.applied"), tt("skins.error.apply"));
  };

  const resetSkin = async () => {
    if (!accountId || !account) return;
    const ok = await confirm({ title: tt("skins.reset_title"), text: tt("skins.reset_text", { name: account.username }), confirmLabel: tt("skins.reset"), danger: true });
    if (ok) await mutate("reset", () => api.skinReset(accountId), tt("skins.applied"), tt("skins.error.apply"));
  };

  const saveCurrent = async () => {
    if (!accountId) return;
    setBusy("save");
    try {
      await api.skinLibraryAddCurrent(accountId);
      void queryClient.invalidateQueries({ queryKey: skq.library });
      toast.success(tt("skins.added"));
    } catch (e) {
      toast.error(e, tt("skins.error.library"));
    } finally {
      setBusy(null);
    }
  };

  const canEdit = !!profile && !busy;
  const libraryTab = !(tab === "mccapes" && account);

  return (
    <div ref={pageRef} className="flex h-full min-h-0 flex-col bg-panel">
      <div className="shrink-0 px-6 pb-4 pt-4">
        <PageToolbar
          actions={
            libraryTab && (
              <>
                <ImportByName />
                <AddFileButton />
              </>
            )
          }
        >
          {accounts.length > 1 ? (
            <div className="w-[220px] min-w-[160px] shrink">
              <Select
                variant="ghost"
                value={accountId}
                onChange={(v) => setChosen(v)}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <PlayerHead uuid={a.uuid} name={a.username} size={18} />
                      {a.username}
                    </span>
                  ),
                }))}
              />
            </div>
          ) : account ? (
            <span className="flex items-center gap-2 px-1 text-[13.5px] font-semibold text-text">
              <PlayerHead uuid={account.uuid} name={account.username} size={20} />
              {account.username}
            </span>
          ) : null}
        </PageToolbar>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(340px,1fr)_minmax(360px,1.1fr)] gap-4 px-6 pb-6">
        {/* ------------------------------------------------------------ Viewer + aktueller Skin */}
        <section data-tour="skins-viewer" className="flex min-h-0 flex-col overflow-hidden rounded-card bg-surface">
          <div className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-text">
                {preview?.skin ? t("skins.preview_of", { name: preview.skin.name }) : preview ? t("skins.preview") : (account?.username ?? t("skins.preview"))}
              </div>
              <div className="truncate text-caption text-dim">{preview ? t("skins.preview") : account ? t("skins.current") : t("skins.no_account_title")}</div>
            </div>
            <Segmented
              value={viewerVariant}
              onChange={changeVariant}
              items={[
                { value: "classic", label: t("skins.classic"), disabled: !preview?.skin && !canEdit },
                { value: "slim", label: t("skins.slim"), disabled: !preview?.skin && !canEdit },
              ]}
            />
            {account && (
              <>
                <IconButton label={t("skins.upload")} tip variant="ghost" size="sm" onClick={() => void uploadFile()} disabled={!canEdit}>
                  {busy === "upload" ? <Spinner size={13} /> : <FileUp size={15} />}
                </IconButton>
                <DropdownMenu
                  trigger={
                    <IconButton label={t("common.more")} tip variant="ghost" size="sm">
                      <MoreHorizontal size={16} />
                    </IconButton>
                  }
                >
                  <DropdownItem icon={<FileUp size={14} />} disabled={!canEdit} onSelect={() => void uploadFile()}>
                    {t("skins.upload")}
                  </DropdownItem>
                  <DropdownItem icon={<Save size={14} />} disabled={!profile?.skin || !!busy} onSelect={() => void saveCurrent()}>
                    {t("skins.save_current")}
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem icon={<RotateCcw size={14} />} danger disabled={!canEdit} onSelect={() => void resetSkin()}>
                    {t("skins.reset")}
                  </DropdownItem>
                </DropdownMenu>
              </>
            )}
          </div>

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

          {preview && (
            <div className="flex shrink-0 items-center gap-2 bg-surface2 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-meta text-muted">
                {account ? t("skins.apply_hint", { name: account.username }) : t("skins.no_account_title")}
              </span>
              <Button size="sm" variant="subtle" icon={<X size={14} />} onClick={() => setPreview(null)} disabled={!!busy}>
                {t("skins.cancel_preview")}
              </Button>
              {account ? (
                <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => void applyPreview()} disabled={!profile} loading={busy === "apply"}>
                  {t("skins.apply")}
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon={<LogIn size={14} />} onClick={() => setMsa(true)}>
                  {t("skins.login")}
                </Button>
              )}
            </div>
          )}

          {account && !account.needs_relogin && (
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
          )}
        </section>

        {/* ------------------------------------------------------------ Bibliothek */}
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
                <EmptyState className="h-full" icon={<Shirt size={28} />} title={t("skins.library_empty_title")} text={t("skins.library_empty_text")} action={<AddFileButton />} />
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
      </div>

      <RenameDialog skin={renaming} onClose={() => setRenaming(null)} />
      <MsaDialog open={msa} onOpenChange={setMsa} />
    </div>
  );
}

function AddFileButton() {
  const t = useT();
  return (
    <Button
      variant="ghost"
      icon={<ImagePlus size={15} />}
      onClick={async () => {
        const sel = await openDialog({ multiple: true, filters: [{ name: "PNG", extensions: ["png"] }] });
        if (sel) await addFiles(Array.isArray(sel) ? sel : [sel]);
      }}
    >
      {t("skins.add_file")}
    </Button>
  );
}

/** MinecraftCapes-Kachel in der Cape-Leiste (klar getrennt von den offiziellen Capes). */
function McTile({ profile, frames, selected, onClick }: { profile: McProfile; frames: McCapeFrames | null; selected: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <Tooltip content={`${t("mccapes.title")} · ${t("mccapes.show_in_preview")}`}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "relative grid h-[76px] w-[58px] place-items-center rounded-ctl transition-colors duration-150",
          selected ? "bg-surface3 outline outline-2 outline-accent" : "bg-surface2 hover:bg-surface3",
        )}
      >
        {profile.cape ? <McCapeThumb frames={frames} scale={4} /> : <Sparkles size={18} className="text-dim" />}
        {profile.cape && profile.glint && (
          <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-pill bg-[#7b4dff] text-text">
            <Sparkles size={10} strokeWidth={2.5} />
          </span>
        )}
      </button>
    </Tooltip>
  );
}

function CenterSpinner() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <Spinner size={20} />
    </div>
  );
}

function NoAccount({ onLogin, relogin }: { onLogin: () => void; relogin?: boolean }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <UserRound size={24} className="text-dim" />
      <div>
        <div className="text-[15px] font-semibold text-text">{t("skins.no_account_title")}</div>
        <p className="mt-1 max-w-[360px] text-[13px] text-muted">{relogin ? t("skins.relogin_text") : t("skins.no_account_text")}</p>
      </div>
      <Button variant="primary" icon={<LogIn size={15} />} onClick={onLogin}>
        {t("skins.login")}
      </Button>
    </div>
  );
}

function CapeTile({ cape, label, selected, active, onClick }: { cape?: Cape; label: string; selected: boolean; active: boolean; onClick: () => void }) {
  const t = useT();
  const img = useCapeFront(cape?.data_url ?? null, 4);
  return (
    <Tooltip content={active ? `${label} · ${t("skins.cape_active")}` : label}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "relative grid h-[76px] w-[58px] place-items-center rounded-ctl transition-colors duration-150",
          selected ? "bg-surface3 outline outline-2 outline-accent" : "bg-surface2 hover:bg-surface3",
        )}
      >
        {cape ? (
          img ? (
            <img src={img} alt={label} className="h-[64px] w-[40px] [image-rendering:pixelated]" draggable={false} />
          ) : (
            <Skeleton className="h-[64px] w-[40px]" />
          )
        ) : (
          <X size={18} className="text-dim" />
        )}
        {active && (
          <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-pill bg-accent text-[var(--on-accent)]">
            <Check size={10} strokeWidth={3} />
          </span>
        )}
      </button>
    </Tooltip>
  );
}

function sourceLabel(src: string | null): string | null {
  if (!src) return null;
  if (src === "file") return tt("skins.source_file");
  const [kind, name] = [src.slice(0, src.indexOf(":")), src.slice(src.indexOf(":") + 1)];
  if (kind === "account") return tt("skins.source_account", { name });
  if (kind === "player") return tt("skins.source_player", { name });
  if (kind === "import" && name in sourceLabels) return tt("skins.source_import", { app: sourceLabels[name as ImportSource] });
  return null;
}

const LibraryTile = memo(function LibraryTile({
  skin: s,
  selected,
  canApply,
  onPreview,
  onApply,
  onRename,
}: {
  skin: LibrarySkin;
  selected: boolean;
  canApply: boolean;
  onPreview: () => void;
  onApply: () => void;
  onRename: () => void;
}) {
  const t = useT();
  const img = useSkinFront(s.data_url, s.variant, 6);
  const src = sourceLabel(s.source);
  const exportSkin = async () => {
    const path = await saveDialog({ defaultPath: `${s.name}.png`, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!path) return;
    api
      .skinLibraryExport(s.id, path)
      .then(() => toast.success(tt("skins.exported")))
      .catch((e) => toast.error(e, tt("skins.error.library")));
  };
  const remove = async () => {
    const ok = await confirm({ title: tt("skins.delete_title", { name: s.name }), text: tt("skins.delete_text"), confirmLabel: tt("skins.delete"), danger: true });
    if (ok) api.skinLibraryRemove(s.id).then(() => queryClient.invalidateQueries({ queryKey: skq.library })).catch((e) => toast.error(e, tt("skins.error.library")));
  };
  const setVariant = (v: SkinVariant) =>
    api
      .skinLibrarySetVariant(s.id, v)
      .then(() => queryClient.invalidateQueries({ queryKey: skq.library }))
      .catch((e) => toast.error(e, tt("skins.error.library")));
  const menu: ReactNode = (
    <>
      <ContextItem icon={<Check size={14} />} disabled={!canApply} onSelect={onApply}>
        {t("skins.apply")}
      </ContextItem>
      <ContextItem icon={<Pencil size={14} />} onSelect={onRename}>
        {t("skins.rename")}
      </ContextItem>
      <ContextItem icon={<Shirt size={14} />} onSelect={() => void setVariant(s.variant === "slim" ? "classic" : "slim")}>
        {s.variant === "slim" ? t("skins.set_classic") : t("skins.set_slim")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<Download size={14} />} onSelect={() => void exportSkin()}>
        {t("skins.export")}
      </ContextItem>
      <ContextItem icon={<FolderOpen size={14} />} onSelect={() => void api.skinLibraryReveal(s.id).catch((e) => toast.error(e))}>
        {t("skins.reveal")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => void remove()}>
        {t("skins.delete")}
      </ContextItem>
    </>
  );
  return (
    <ContextMenu content={menu}>
      <button
        type="button"
        onClick={onPreview}
        onDoubleClick={() => canApply && onApply()}
        aria-pressed={selected}
        className={cn(
          "group flex flex-col items-stretch overflow-hidden rounded-card text-left transition-colors duration-150",
          selected ? "bg-surface3 outline outline-2 outline-accent" : "bg-surface hover:bg-surface2 data-[state=open]:bg-surface2",
        )}
      >
        <div className="grid h-[118px] place-items-center">
          {img ? (
            <img src={img} alt="" draggable={false} loading="lazy" decoding="async" className="h-[104px] w-[52px] [image-rendering:pixelated]" />
          ) : (
            <Skeleton className="h-[104px] w-[52px]" />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 px-2 pb-2 pt-1">
          <span className="truncate text-[12.5px] font-semibold text-text" title={s.name}>
            {s.name}
          </span>
          {/* Modell und Herkunft je eine Zeile – sonst schneidet die schmale Kachel die Herkunft ab */}
          <span className="truncate text-[11.5px] text-muted">{s.variant === "slim" ? t("skins.slim") : t("skins.classic")}</span>
          {src && (
            <span className="truncate text-[11.5px] text-dim" title={src}>
              {src}
            </span>
          )}
        </div>
      </button>
    </ContextMenu>
  );
});

function ImportByName() {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = useMemo(() => /^[A-Za-z0-9_]{1,16}$/.test(name.trim()), [name]);
  const run = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const s = await api.skinLibraryImportPlayer(name.trim());
      void queryClient.invalidateQueries({ queryKey: skq.library });
      toast.success(tt("skins.imported", { name: s.name }));
      setName("");
    } catch (e) {
      toast.error(e, tt("skins.error.import"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex shrink-0 items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <Input
        className="w-[230px]"
        value={name}
        maxLength={16}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("skins.import_placeholder")}
        aria-label={t("skins.import_player")}
      />
      <IconButton label={t("skins.import")} tip variant="ghost" type="submit" disabled={!valid || busy}>
        {busy ? <Spinner size={13} /> : <Download size={15} />}
      </IconButton>
    </form>
  );
}

function RenameDialog({ skin, onClose }: { skin: LibrarySkin | null; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (skin) setName(skin.name);
  }, [skin]);
  const submit = async () => {
    if (!skin || !name.trim()) return;
    setBusy(true);
    try {
      await api.skinLibraryRename(skin.id, name.trim());
      void queryClient.invalidateQueries({ queryKey: skq.library });
      onClose();
    } catch (e) {
      toast.error(e, tt("skins.error.library"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!skin}
      onOpenChange={(o) => !o && onClose()}
      title={t("skins.rename_title")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!name.trim()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input autoFocus value={name} maxLength={48} onChange={(e) => setName(e.target.value)} aria-label={t("skins.name")} />
      </form>
    </Dialog>
  );
}
