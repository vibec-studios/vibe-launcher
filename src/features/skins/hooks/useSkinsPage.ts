import { useQuery } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { confirm, toast } from "@/components/ui";
import { t as tt } from "@/i18n";
import { api } from "@/lib/api";
import { useEvent } from "@/lib/events";
import { queryClient, useAccounts } from "@/lib/queries";
import type { LibrarySkin, SkinProfile, SkinVariant } from "@/lib/types";
import { registerDropTarget, useDragState } from "@/components/content/dragdrop";
import type { ViewerAnimation } from "../SkinViewer3D";
import { useCapeFrames, useMcCapesEnabled, useMcProfile } from "../minecraftcapes";
import type { EditorAccount, EditorSource } from "../editor/SkinEditorDialog";
import { DROP_ID, addFiles, isPng, setProfile, skq, type Preview } from "../library";

export function useSkinsPage() {
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSource, setEditorSource] = useState<EditorSource | null>(null);
  const openEditor = (s: EditorSource | null) => {
    setEditorSource(s);
    setEditorOpen(true);
  };

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
  const editorAccount: EditorAccount | null =
    account && profile ? { id: account.id, name: account.username, skin: profile.skin?.data_url ? { dataUrl: profile.skin.data_url, variant: profile.skin.variant } : null } : null;
  const editShown = () =>
    openEditor(
      viewerSkin ? { dataUrl: viewerSkin, name: preview?.skin?.name ?? account?.username ?? null, variant: viewerVariant } : null,
    );
  const libraryTab = !(tab === "mccapes" && mcEnabled && account);

  return {
    accounts,
    account,
    accountId,
    setChosen,
    msa,
    setMsa,
    profileQ,
    libraryQ,
    profile,
    preview,
    setPreview,
    anim,
    setAnim,
    rotate,
    setRotate,
    busy,
    renaming,
    setRenaming,
    tab,
    setTab,
    editorOpen,
    setEditorOpen,
    editorSource,
    openEditor,
    mcEnabled,
    mcQ,
    mcProfile,
    mcFrames,
    mcHas,
    mcShown,
    setMcShown,
    pageRef,
    dragOver,
    mutate,
    activeCape,
    shownCapeId,
    shownCape,
    viewerSkin,
    viewerVariant,
    applyPreview,
    changeVariant,
    uploadFile,
    resetSkin,
    saveCurrent,
    canEdit,
    editorAccount,
    editShown,
    libraryTab,
  };
}

export type SkinsPageState = ReturnType<typeof useSkinsPage>;
