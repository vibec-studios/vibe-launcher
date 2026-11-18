// Creator-Bereich (/cosmetics/creator): Tools installieren (Blockbench + Vibey-Plugin, Creator-Modus erklären),
// eigene Cosmetics hochladen (.vibey wählen, 3D-Vorschau, Name/Beschreibung, Vorschaubild → Einreichung) und
// „Meine Einreichungen“ mit Status, Zurückziehen und Live-Update (submission.updated).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, Clock, Eye, FileUp, ImagePlus, Inbox, ShieldCheck, Trash2, Upload, Wrench, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, EmptyState, ErrorState, Field, Input, Spinner, Tabs, Textarea, cn, confirm, toast } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import { useLang, useT } from "@/i18n";
import { capi, readPng, vapi } from "./api";
import { cqk, parseBundle, useAccess, useSubmissions, itemName } from "./data";
import { AccessState } from "./parts";
import { CreatorTools } from "./CreatorTools";
import type { Submission } from "./types";
import { checkVibey, type Check } from "./validate";
import { Viewer3D, useOwnSkin, type Viewer3DHandle } from "./Viewer3D";
import type { Bundle } from "./vibey3d";

type Tab = "tools" | "upload" | "submissions";
const MAX_OPEN = 5;

export function CreatorPage() {
  const t = useT();
  const nav = useNavigate();
  const access = useAccess();
  const [tab, setTab] = useState<Tab>("tools");
  const subs = useSubmissions(access === "ready");
  const pending = subs.data?.filter((s) => s.status === "pending").length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-line bg-panel">
        <div className="flex items-center gap-4 px-6 pb-2 pt-4">
          <button aria-label={t("common.back")} onClick={() => nav({ to: "/cosmetics" })} className="grid h-9 w-9 place-items-center border border-line bg-surface2 text-muted hover:text-white">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="display text-[20px] leading-tight">{t("cre.title")}</h1>
            <p className="mt-0.5 truncate text-[13px] text-muted">{t("cre.lead")}</p>
          </div>
        </div>
        <div className="px-6">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            className="-mx-3 h-11! border-b-0"
            items={[
              { value: "tools", label: t("cre.tab.tools"), icon: <Wrench size={14} /> },
              { value: "upload", label: t("cre.tab.upload"), icon: <Upload size={14} /> },
              { value: "submissions", label: t("cre.tab.submissions"), icon: <Inbox size={14} />, badge: pending || undefined },
            ]}
          />
        </div>
      </header>
      <div className="scroll min-h-0 flex-1">
        {tab === "tools" ? (
          <CreatorTools online={access === "ready" || access === "logged_out" || access === "no_account"} />
        ) : access !== "ready" ? (
          <AccessState access={access} />
        ) : tab === "upload" ? (
          <UploadTab pending={pending} onDone={() => setTab("submissions")} />
        ) : (
          <SubmissionsTab />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Hochladen

type ThumbMode = "auto" | "view" | "file" | "none";

function UploadTab({ pending, onDone }: { pending: number; onDone: () => void }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const qc = useQueryClient();
  const skin = useOwnSkin();
  const viewer = useRef<Viewer3DHandle>(null);
  const [file, setFile] = useState<{ path: string; check: Check; bundle: Bundle | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [thumbMode, setThumbMode] = useState<ThumbMode>("auto");
  const [thumb, setThumb] = useState<string | null>(null);
  // Automatisches Vorschaubild im Katalog-Stil (Cosmetic ohne Spieler, Emote am neutralen Spieler)
  const [autoThumb, setAutoThumb] = useState<string | null>(null);
  const bundle = file?.bundle ?? null;
  useEffect(() => {
    setAutoThumb(null);
    if (!bundle) return;
    let dead = false;
    void import("./vibey3d")
      .then((m) => m.renderThumbnail(bundle))
      .then((u) => !dead && setAutoThumb(u))
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [bundle]);

  const pick = async () => {
    // Nur Dev-Builds: automatisierte UI-Tests können den nativen Dateidialog nicht bedienen
    const testPick = import.meta.env.MODE === "development" ? (window as unknown as { __vibeyTestPick?: string }).__vibeyTestPick : undefined;
    const p = testPick ?? (await openDialog({ multiple: false, directory: false, filters: [{ name: "Vibey", extensions: ["vibey"] }] }));
    if (typeof p !== "string") return;
    setLoading(true);
    try {
      const text = await vapi.bundleRead(p);
      const check = checkVibey(text);
      let bundle: Bundle | null = null;
      if (check.ok && check.json) bundle = await parseBundle(check.json).catch(() => null);
      setFile({ path: p, check, bundle });
      const j = check.json;
      if (j?.name) setName((lang === "de" ? j.name.de : undefined) ?? j.name.en ?? "");
      if (j?.description) setDesc(((lang === "de" ? j.description.de : undefined) ?? j.description.en ?? "").slice(0, 500));
    } catch (e) {
      toast.error(e, t("cre.up.read_failed"));
    } finally {
      setLoading(false);
    }
  };

  const pickThumb = async () => {
    const p = await openDialog({ multiple: false, directory: false, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (typeof p !== "string") return;
    try {
      const r = await readPng(p);
      // Größere/nicht quadratische Bilder auf 256×256 einpassen (Backend: PNG ≤ 256×256)
      setThumb(r.width === 256 && r.height === 256 ? r.dataUrl : await fitPng(r.dataUrl, 256));
      setThumbMode("file");
    } catch (e) {
      toast.error(e);
    }
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t("cre.up.no_file"));
      let thumbnail: string | null = null;
      if (thumbMode === "file") thumbnail = thumb;
      else if (thumbMode === "auto") thumbnail = autoThumb;
      else if (thumbMode === "view") thumbnail = viewer.current?.snapshot(256) ?? null;
      const token = await capi.token();
      return vapi.submissionUpload(token, file.path, name.trim(), desc.trim(), thumbnail);
    },
    onSuccess: (r) => {
      qc.setQueryData<Submission[]>(cqk.submissions, (l) => (r?.submission ? [r.submission, ...(l ?? []).filter((x) => x.id !== r.submission.id)] : l));
      void qc.invalidateQueries({ queryKey: cqk.submissions });
      toast.success(t("cre.up.sent"), t("cre.up.sent_text"));
      setFile(null);
      setName("");
      setDesc("");
      setThumb(null);
      setThumbMode("auto");
      onDone();
    },
    onError: (e) => toast.error(e, t("cre.up.failed")),
  });

  const full = pending >= MAX_OPEN;
  const b = file?.bundle ?? null;
  const emote = b?.json.kind === "emote";
  const canSend = !!file?.check.ok && name.trim().length > 0 && !full;
  const slot = b?.json.cosmetic?.slot;

  return (
    <div className="mx-auto grid max-w-[1100px] grid-cols-[1fr_420px] gap-6 p-6">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-start gap-3 border border-brand/30 bg-brand/[.07] px-4 py-3 text-[13px] leading-relaxed text-muted">
          <ShieldCheck size={17} className="mt-0.5 shrink-0 text-brand" />
          <div>
            <span className="font-semibold text-white">{t("cre.up.review_title")}</span> {t("cre.up.review_text", { n: MAX_OPEN })}
          </div>
        </div>

        <button
          onClick={() => void pick()}
          className={cn(
            "flex items-center gap-4 border border-dashed px-5 py-5 text-left transition-colors",
            file ? "border-line2 bg-surface" : "border-brand/50 bg-brand/[.04] hover:border-brand hover:bg-brand/[.08]",
          )}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center border border-line2 bg-surface2 text-brand">{loading ? <Spinner size={16} /> : <FileUp size={20} />}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-white">{file ? file.path.split(/[\\/]/).pop() : t("cre.up.pick")}</span>
            <span className="block truncate text-[12px] text-dim">{file ? (file.check.json?.id as string) ?? file.path : t("cre.up.pick_hint")}</span>
          </span>
          <span className="text-[12px] font-semibold text-brand">{file ? t("cre.up.change") : t("cre.up.choose")}</span>
        </button>

        {file && !file.check.ok && (
          <div className="border border-danger/40 bg-danger/[.07] px-4 py-3 text-[13px]">
            <div className="mb-1.5 flex items-center gap-2 font-semibold text-danger">
              <AlertTriangle size={15} /> {t("cre.up.invalid")}
            </div>
            <ul className="list-disc pl-5 text-muted">
              {file.check.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {file && file.check.warnings.length > 0 && (
          <ul className="border border-warn/30 bg-warn/[.06] px-4 py-2.5 text-[12px] text-warn">
            {file.check.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        <Field label={t("cre.up.name")}>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("cre.up.name_ph")} disabled={!file?.check.ok} />
        </Field>
        <Field label={t("cre.up.desc")} hint={`${desc.length}/500`}>
          <Textarea value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} placeholder={t("cre.up.desc_ph")} disabled={!file?.check.ok} />
        </Field>

        <Field label={t("cre.up.thumb")}>
          <div className="flex items-center gap-3">
            <div className="grid h-[72px] w-[72px] shrink-0 place-items-center border border-line bg-black/40">
              {thumbMode === "file" && thumb ? (
                <img src={thumb} alt="" className="h-full w-full object-contain" />
              ) : thumbMode === "auto" && autoThumb ? (
                <img src={autoThumb} alt="" className="h-full w-full object-contain" />
              ) : thumbMode === "auto" || thumbMode === "view" ? (
                <Camera size={18} className="text-dim" />
              ) : (
                <span className="text-[11px] text-dim">—</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["auto", "view", "file", "none"] as ThumbMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => (m === "file" ? void pickThumb() : setThumbMode(m))}
                  className={cn("h-8 border px-3 text-[12px] font-semibold transition-colors", thumbMode === m ? "border-brand bg-brand/15 text-white" : "border-line bg-surface2 text-muted hover:text-white")}
                >
                  {m === "file" && <ImagePlus size={12} className="mr-1.5 inline" />}
                  {t(`cre.up.thumb_${m}`)}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1.5 text-[12px] text-dim">{t("cre.up.thumb_hint")}</p>
        </Field>

        <div className="flex items-center gap-3 border-t border-line pt-4">
          {full && <span className="text-[12px] text-warn">{t("cre.up.full", { n: MAX_OPEN })}</span>}
          <span className="ml-auto" />
          <Button variant="primary" size="lg" icon={<Upload size={16} />} disabled={!canSend} loading={submit.isPending} onClick={() => submit.mutate()}>
            {t("cre.up.send")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col border border-line bg-[radial-gradient(120%_70%_at_50%_30%,rgba(139,108,255,.10),transparent_65%)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[.16em] text-dim">{t("cre.up.preview")}</span>
          {b && <span className="text-[12px] text-muted">{t(`cos.slot.${emote ? "emote" : slot}`)}</span>}
        </div>
        {b ? (
          <Viewer3D
            ref={viewer}
            className="min-h-[440px] flex-1"
            bundles={emote ? [] : [b]}
            emote={emote ? b : null}
            focus={slot && ["cape", "wings", "back"].includes(slot) ? "back" : "front"}
            focusKey={file?.path}
            skin={skin}
          />
        ) : (
          <div className="grid min-h-[440px] flex-1 place-items-center px-8 text-center text-[13px] text-dim">{t("cre.up.preview_empty")}</div>
        )}
        {b && (
          <div className="border-t border-line px-4 py-3 text-[12px] text-muted">
            <span className="font-semibold text-white">{itemName(b.json, lang)}</span> · <span className="font-mono">{b.json.id}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** PNG mittig in ein Quadrat `size`×`size` einpassen (transparenter Rand). */
async function fitPng(src: string, size: number): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const k = Math.min(size / img.width, size / img.height);
  const w = Math.max(1, Math.round(img.width * k)),
    h = Math.max(1, Math.round(img.height * k));
  g.imageSmoothingEnabled = k < 1;
  g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return c.toDataURL("image/png");
}

// ------------------------------------------------------------------ Meine Einreichungen

const STATUS: Record<Submission["status"], { icon: typeof Clock; cls: string }> = {
  pending: { icon: Clock, cls: "border-warn/40 bg-warn/10 text-warn" },
  approved: { icon: CheckCircle2, cls: "border-ok/40 bg-ok/10 text-ok" },
  rejected: { icon: XCircle, cls: "border-danger/40 bg-danger/10 text-danger" },
  withdrawn: { icon: Trash2, cls: "border-line2 bg-white/5 text-dim" },
};

function SubmissionsTab() {
  const t = useT();
  const qc = useQueryClient();
  const q = useSubmissions(true);
  const [preview, setPreview] = useState<Submission | null>(null);

  const withdraw = async (s: Submission) => {
    if (!(await confirm({ title: t("cre.sub.withdraw_title"), text: t("cre.sub.withdraw_text", { name: s.name }), danger: true, confirmLabel: t("cre.sub.withdraw") }))) return;
    try {
      await capi.withdraw(s.id);
      qc.setQueryData<Submission[]>(cqk.submissions, (l) => l?.map((x) => (x.id === s.id ? { ...x, status: "withdrawn" } : x)));
      void qc.invalidateQueries({ queryKey: cqk.submissions });
      toast.success(t("cre.sub.withdrawn"));
    } catch (e) {
      toast.error(e, t("cre.sub.withdraw_failed"));
    }
  };

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-16" />;
  if (!q.data)
    return (
      <div className="grid place-items-center py-20">
        <Spinner size={18} className="text-brand" />
      </div>
    );
  const pending = q.data.filter((s) => s.status === "pending").length;
  return (
    <div className="mx-auto max-w-[980px] p-6">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="display text-[15px] text-white">{t("cre.sub.title")}</h2>
        <span className="font-mono text-[12px] text-dim">{t("cre.sub.open", { n: pending, max: MAX_OPEN })}</span>
        <span className="ml-auto text-[12px] text-dim">{t("cre.sub.live")}</span>
      </div>
      {q.data.length === 0 ? (
        <EmptyState icon={<Inbox size={20} />} title={t("cre.sub.empty")} text={t("cre.sub.empty_text")} />
      ) : (
        <div className="flex flex-col gap-2">
          {q.data.map((s) => {
            const st = STATUS[s.status] ?? STATUS.pending;
            const Icon = st.icon;
            return (
              <div key={s.id} className="flex items-center gap-4 border border-line bg-surface p-3">
                <SubmissionThumb s={s} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-white">{s.name}</span>
                    <span className="text-[12px] text-dim">· {t(`cre.sub.kind.${s.kind}`)}</span>
                  </div>
                  {s.description && <div className="mt-0.5 truncate text-[12px] text-muted">{s.description}</div>}
                  <div className="mt-1 text-[11px] text-dim">
                    {t("cre.sub.sent", { when: formatRelative(s.createdAt) })}
                    {s.reviewedAt && <> · {t("cre.sub.reviewed", { when: formatRelative(s.reviewedAt) })}</>}
                  </div>
                  {s.status === "rejected" && s.reason && (
                    <div className="mt-1.5 border-l-2 border-danger/60 bg-danger/[.06] px-2 py-1 text-[12px] text-text">
                      <span className="font-semibold text-danger">{t("cre.sub.reason")}:</span> {s.reason}
                    </div>
                  )}
                </div>
                <span className={cn("flex h-7 shrink-0 items-center gap-1.5 border px-2.5 text-[12px] font-semibold", st.cls)}>
                  <Icon size={13} /> {t(`cre.sub.status.${s.status}`)}
                </span>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="subtle" icon={<Eye size={14} />} onClick={() => setPreview(s)}>
                    {t("cre.sub.preview")}
                  </Button>
                  {s.status === "pending" && (
                    <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => void withdraw(s)}>
                      {t("cre.sub.withdraw")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <SubmissionPreview s={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function SubmissionThumb({ s }: { s: Submission }) {
  // Vorschaubild vom Server (nur für den Einreicher, daher mit Token), sonst aus dem eigenen Bundle gerendert
  const q = useQuery({
    queryKey: ["vibe", "cosmetics", "subthumb", s.id, s.thumbnailUrl ?? ""],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      if (s.thumbnailUrl) {
        const url = await vapi.thumbnail(s.thumbnailUrl, await capi.token().catch(() => null)).catch(() => null);
        if (url) return url;
      }
      const b = await parseBundle(await capi.submissionAsset(s.id));
      return (await import("./vibey3d")).renderThumbnail(b);
    },
  });
  return (
    <div className="grid h-16 w-16 shrink-0 place-items-center border border-line bg-black/40 text-dim">
      {q.data ? <img src={q.data} alt="" className="h-full w-full object-contain" /> : q.isError ? <ImagePlus size={18} /> : <Spinner size={13} />}
    </div>
  );
}

function SubmissionPreview({ s, onClose }: { s: Submission | null; onClose: () => void }) {
  const t = useT();
  const skin = useOwnSkin();
  const [state, setState] = useState<{ id: string; b: Bundle | null; err: unknown } | null>(null);
  if (s && state?.id !== s.id) {
    setState({ id: s.id, b: null, err: null });
    void capi
      .submissionAsset(s.id)
      .then((j) => parseBundle(j))
      .then(
        (b) => setState((x) => (x?.id === s.id ? { id: s.id, b, err: null } : x)),
        (err) => setState((x) => (x?.id === s.id ? { id: s.id, b: null, err } : x)),
      );
  }
  const b = state?.b ?? null;
  const emote = b?.json.kind === "emote";
  return (
    <Dialog open={!!s} onOpenChange={(o) => !o && (onClose(), setState(null))} size="lg" title={s?.name ?? ""} description={t("cre.sub.preview_hint")}>
      <div className="h-[460px] border border-line bg-[radial-gradient(120%_70%_at_50%_30%,rgba(139,108,255,.10),transparent_65%)]">
        {b ? (
          <Viewer3D className="h-full" bundles={emote ? [] : [b]} emote={emote ? b : null} focus={["cape", "wings", "back"].includes(b.json.cosmetic?.slot ?? "") ? "back" : "front"} focusKey={s?.id} skin={skin} />
        ) : state?.err ? (
          <ErrorState error={state.err} className="h-full" />
        ) : (
          <div className="grid h-full place-items-center">
            <Spinner size={18} className="text-brand" />
          </div>
        )}
      </div>
    </Dialog>
  );
}
