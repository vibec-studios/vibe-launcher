import { useState } from "react";
import { Film, ImagePlus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { isVideoFile } from "@/lib/appearance";
import { imageSrc } from "@/lib/format";
import { Button, toast } from "@/components/ui";
import { useT } from "@/i18n";

export function FilePick({ slot, path, onPicked, onRemove }: { slot: "image" | "video"; path: string | null; onPicked: (p: string) => void; onRemove: () => void }) {
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
