// Clip abspielen (HTML5-Video über das Asset-Protokoll), Kill-Marken, Infos und Bearbeiten (Behalten, Titel, Tags).
// Der Launcher ändert nur `kept`, `title`, `tags` (docs/CLIPS.md §10.3 im Vibey Client).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FolderOpen, History, Scissors, Skull, Star, Swords, Trash2, VideoOff, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Clip, ClipExport } from "@/lib/types";
import { formatBytes, formatDate, imageSrc } from "@/lib/format";
import { Button, Dialog, Field, Input, Tag, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { ReasonIcon, clipName, clipWhere, formatClipLength, reasonColor, reasonKey } from "./clips";
import { ClipEditor } from "./ClipEditor";

const TITLE_MAX = 100;
const TAGS_MAX = 16;
const TAG_MAX = 32;
/** So viel vor einem Kill springt ein Klick auf die Marke */
const LEAD_MS = 2000;

function sameTags(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function ClipPlayer({
  clip,
  instanceName,
  onClose,
  onChanged,
  onDelete,
  onExported,
}: {
  clip: Clip | null;
  instanceName: (id: string) => string;
  onClose: () => void;
  onChanged: (c: Clip) => void;
  onDelete: (c: Clip) => void;
  onExported?: (r: ClipExport) => void;
}) {
  const t = useT();
  const open = clip !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} size="xl" title={clip ? clipName(clip, t) : ""} description={clip ? <Subtitle clip={clip} /> : undefined}>
      {clip && (
        <PlayerBody
          key={`${clip.instance_id}/${clip.id}`}
          clip={clip}
          instanceName={instanceName(clip.instance_id)}
          onChanged={onChanged}
          onDelete={onDelete}
          onExported={onExported}
        />
      )}
    </Dialog>
  );
}

function Subtitle({ clip }: { clip: Clip }) {
  const t = useT();
  const when = `${formatDate(clip.created_at)} ${new Date(clip.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <ReasonTag reason={clip.reason} />
      {clip.rewind && <RewindTag />}
      <span>{when}</span>
      {clip.title && <span className="text-dim">· {clipWhere(clip, t)}</span>}
    </span>
  );
}

export function RewindTag({ className }: { className?: string }) {
  const t = useT();
  return (
    <Tag color="#7cc4ff" className={className}>
      <History size={11} />
      {t("clipedit.rewind")}
    </Tag>
  );
}

export function ReasonTag({ reason, className }: { reason: string; className?: string }) {
  const t = useT();
  return (
    <Tag color={reasonColor[reason]} className={className}>
      <ReasonIcon reason={reason} size={11} />
      {t(reasonKey(reason))}
    </Tag>
  );
}

function PlayerBody({
  clip,
  instanceName,
  onChanged,
  onDelete,
  onExported,
}: {
  clip: Clip;
  instanceName: string;
  onChanged: (c: Clip) => void;
  onDelete: (c: Clip) => void;
  onExported?: (r: ClipExport) => void;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [editing, setEditing] = useState(clip.rewind || !!clip.trim);
  const [failed, setFailed] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState((clip.duration_ms ?? 0) / 1000);

  // Quelle im Effekt setzen und beim Schließen wieder freigeben (sonst bleibt die MP4 unter Windows evtl. gesperrt
  // und lässt sich nicht löschen). Nicht als Prop: StrictMode räumt einmal auf und setzt dann neu.
  const src = imageSrc(clip.video_path);
  useEffect(() => {
    const v = video.current;
    if (!v || !src) return;
    v.src = src;
    return () => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, [src, failed]);

  const seek = (sec: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(sec, v.duration || dur));
    v.play().catch(() => {});
  };

  const total = dur > 0 ? dur : (clip.duration_ms ?? 0) / 1000;
  const markers = clip.events.filter((e) => e.t_ms >= 0 && total > 0 && e.t_ms / 1000 <= total + 0.5);

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="relative overflow-hidden rounded-card bg-black">
        {failed ? (
          <div className="grid aspect-video place-items-center p-6 text-center text-[13px] text-muted">
            <div className="flex max-w-[360px] flex-col items-center gap-3">
              <VideoOff size={28} className="text-dim" />
              {t("clips.video_error")}
            </div>
          </div>
        ) : (
          <video
            ref={video}
            controls
            autoPlay
            playsInline
            preload="metadata"
            className="mx-auto block aspect-video max-h-[52vh] w-full bg-black object-contain"
            onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
            onError={() => setFailed(true)}
          />
        )}
      </div>

      {/* Zeitleiste mit Kill-/Tod-Marken: Klick springt kurz davor */}
      {markers.length > 0 && !failed && (
        <div className="flex flex-col gap-1.5">
          <span className="label">{t("clips.markers")}</span>
          <div
            className="relative h-7 cursor-pointer rounded-ctl bg-field"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seek(((e.clientX - r.left) / r.width) * total);
            }}
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 rounded-ctl bg-white/[.06]" style={{ width: `${total ? Math.min(100, (pos / total) * 100) : 0}%` }} />
            {clip.highlight_ms !== null && total > 0 && (
              <div
                className="pointer-events-none absolute inset-y-1 w-px bg-white/30"
                style={{ left: `${Math.min(100, (clip.highlight_ms / 1000 / total) * 100)}%` }}
                title={t("clips.highlight")}
              />
            )}
            {markers.map((e, n) => {
              const left = Math.min(100, (e.t_ms / 1000 / total) * 100);
              const death = e.type === "death";
              const label = death ? t("clips.marker_death") : e.victim ? t("clips.marker_kill", { name: e.victim }) : t("clips.marker_kill_anon");
              return (
                <Tooltip key={n} content={`${label} · ${formatClipLength(e.t_ms)}`}>
                  <button
                    aria-label={label}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      seek((e.t_ms - LEAD_MS) / 1000);
                    }}
                    className={cn(
                      "absolute top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-pill text-black shadow-e1 transition-transform duration-100 hover:scale-110",
                    )}
                    style={{ left: `${left}%`, background: death ? reasonColor.death : reasonColor.kill }}
                  >
                    {death ? <Skull size={11} /> : <Swords size={11} />}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}

      {editing && !failed && total > 0 && <ClipEditor clip={clip} video={video} pos={pos} total={total} onChanged={onChanged} onExported={(r) => onExported?.(r)} />}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,300px)] gap-6">
        <EditPanel clip={clip} onChanged={onChanged} />
        <InfoPanel clip={clip} instanceName={instanceName} />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => api.clipOpenFolder(clip.instance_id, clip.id).catch((e) => toast.error(e))}>
          {t("clips.show_in_folder")}
        </Button>
        {!failed && (
          <Button size="sm" variant={editing ? "subtle" : "ghost"} icon={<Scissors size={14} />} aria-pressed={editing} onClick={() => setEditing(!editing)}>
            {t("clipedit.button")}
          </Button>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => onDelete(clip)}>
          {t("common.delete")}
        </Button>
      </div>
    </div>
  );
}

function EditPanel({ clip, onChanged }: { clip: Clip; onChanged: (c: Clip) => void }) {
  const t = useT();
  const [title, setTitle] = useState(clip.title ?? "");
  const [tags, setTags] = useState<string[]>(clip.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState<"keep" | "save" | null>(null);

  const dirty = title.trim() !== (clip.title ?? "") || !sameTags(tags, clip.tags);

  const save = async (patch: { kept?: boolean; title?: string; tags?: string[] }, kind: "keep" | "save") => {
    setBusy(kind);
    try {
      const c = await api.clipUpdate(clip.instance_id, clip.id, patch);
      onChanged(c);
      if (kind === "save") {
        setTitle(c.title ?? "");
        setTags(c.tags);
        toast.success(t("clips.saved"));
      }
    } catch (e) {
      toast.error(e, t("clips.save_failed"));
    } finally {
      setBusy(null);
    }
  };

  const addTag = () => {
    const v = tagDraft.trim().slice(0, TAG_MAX);
    if (!v) return;
    if (!tags.some((x) => x.toLowerCase() === v.toLowerCase()) && tags.length < TAGS_MAX) setTags([...tags, v]);
    setTagDraft("");
  };
  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagDraft && tags.length) {
      setTags(tags.slice(0, -1));
    }
  };
  const full = tags.length >= TAGS_MAX;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start gap-3 rounded-card bg-surface px-3.5 py-3">
        <Button
          size="sm"
          variant={clip.kept ? "primary" : "ghost"}
          loading={busy === "keep"}
          icon={<Star size={14} className={cn(clip.kept && "fill-current")} />}
          onClick={() => save({ kept: !clip.kept }, "keep")}
          aria-pressed={clip.kept}
        >
          {clip.kept ? t("clips.filter.kept") : t("clips.keep")}
        </Button>
        <p className="pt-1 text-[12.5px] leading-snug text-muted">{clip.kept ? t("clips.kept_hint") : t("clips.unkept_hint")}</p>
      </div>
      <Field label={t("clips.title_label")} hint={`${title.length}/${TITLE_MAX}`}>
        <Input
          value={title}
          maxLength={TITLE_MAX}
          placeholder={t("clips.title_placeholder")}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) save({ title: title.trim(), tags }, "save");
          }}
        />
      </Field>
      <Field label={t("clips.tags_label")} hint={full ? t("clips.tags_full") : `${tags.length}/${TAGS_MAX}`}>
        <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-ctl bg-field px-2 py-1.5">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-pill bg-white/[.08] pl-2.5 pr-1 text-[12px] font-medium text-text">
              {tag}
              <button
                type="button"
                aria-label={t("clips.tag_remove", { tag })}
                onClick={(e) => {
                  e.preventDefault();
                  setTags(tags.filter((x) => x !== tag));
                }}
                className="grid h-4.5 w-4.5 place-items-center rounded-pill text-dim hover:bg-white/[.1] hover:text-text"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {!full && (
            <input
              value={tagDraft}
              maxLength={TAG_MAX}
              spellCheck={false}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={onTagKey}
              onBlur={addTag}
              placeholder={tags.length ? "" : t("clips.tags_placeholder")}
              className="h-6 min-w-[120px] flex-1 bg-transparent px-1 text-[13px] text-text outline-none placeholder:text-dim"
            />
          )}
        </div>
      </Field>
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={!dirty} loading={busy === "save"} onClick={() => save({ title: title.trim(), tags }, "save")}>
          {t("clips.save")}
        </Button>
      </div>
    </div>
  );
}

function InfoPanel({ clip, instanceName }: { clip: Clip; instanceName: string }) {
  const t = useT();
  const res = clip.width && clip.height ? `${clip.width} × ${clip.height}${clip.fps ? ` · ${Math.round(clip.fps)} fps` : ""}` : null;
  const where =
    clip.mode === "multiplayer"
      ? (clip.server ?? t("clips.server_hidden"))
      : clip.world
        ? `${clip.world} · ${t(`clips.mode.${clip.mode}`)}`
        : clip.mode
          ? t(`clips.mode.${clip.mode}`)
          : null;
  const kills = clip.kills ? t(clip.kills === 1 ? "clips.kills_one" : "clips.kills", { n: clip.kills }) : null;
  const rows: [string, string | null][] = [
    [t("clips.info.reason"), [t(reasonKey(clip.reason)), kills].filter(Boolean).join(" · ")],
    [t("clips.info.where"), where],
    [t("clips.info.date"), `${formatDate(clip.created_at)} ${new Date(clip.created_at).toLocaleTimeString()}`],
    [t("clips.info.length"), formatClipLength(clip.duration_ms)],
    [t("clips.info.size"), clip.size_bytes !== null ? formatBytes(clip.size_bytes) : null],
    [t("clips.info.resolution"), res],
    [
      t("clips.info.encoder"),
      [clip.encoder, clip.video_codec?.toUpperCase(), clip.audio_codec ? clip.audio_codec.toUpperCase() : t("clips.info.audio_none")].filter(Boolean).join(" · "),
    ],
    [t("clips.info.instance"), [instanceName, clip.minecraft].filter(Boolean).join(" · ")],
    [t("clips.info.player"), clip.player?.name ?? null],
  ];
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-4 gap-y-2 text-[13px]">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-dim">{k}</dt>
            <dd className="truncate text-text" title={v ?? undefined}>
              {v}
            </dd>
          </div>
        ))}
    </dl>
  );
}
