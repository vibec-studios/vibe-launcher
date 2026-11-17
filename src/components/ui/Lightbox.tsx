// Bild-Lightbox: Vollbild über dem Fenster, Pfeiltasten/Knöpfe zum Blättern, Esc schließt.
import * as D from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export interface LightboxImage {
  url: string;
  title?: string | null;
  description?: string | null;
}

export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
  labels = { prev: "Zurück", next: "Weiter", close: "Schließen" },
}: {
  images: LightboxImage[];
  /** null = geschlossen */
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  labels?: { prev: string; next: string; close: string };
}) {
  const open = index !== null && images.length > 0;
  const i = index ?? 0;
  const img = images[i];
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [img?.url]);
  const go = (d: number) => onIndexChange((i + d + images.length) % images.length);

  // Nachbarbilder vorladen, damit das Blättern ohne Warten geht
  useEffect(() => {
    if (!open || images.length < 2) return;
    for (const d of [1, -1]) {
      const n = new Image();
      n.decoding = "async";
      n.src = images[(i + d + images.length) % images.length].url;
    }
  }, [open, i, images]);

  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[75] bg-black/92 data-[state=open]:animate-fade-in" />
        <D.Content
          className="fixed inset-0 z-[76] flex flex-col outline-none data-[state=open]:animate-fade-in"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") (e.preventDefault(), go(1));
            else if (e.key === "ArrowLeft") (e.preventDefault(), go(-1));
          }}
          aria-describedby={undefined}
        >
          <D.Title className="sr-only">{img?.title ?? "Bild"}</D.Title>
          <div className="flex h-14 shrink-0 items-center gap-4 px-5">
            <span className="font-mono text-[12px] text-muted">
              {i + 1} / {images.length}
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-white">{img?.title}</span>
            <D.Close aria-label={labels.close} className="grid h-9 w-9 place-items-center border border-line2 text-text transition-colors hover:border-white">
              <X size={18} />
            </D.Close>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-20" onClick={(e) => e.target === e.currentTarget && onClose()}>
            {img && (
              <img
                key={img.url}
                src={img.url}
                alt={img.title ?? ""}
                decoding="async"
                draggable={false}
                onLoad={() => setLoaded(true)}
                className={cn("h-full w-full object-contain transition-opacity duration-150", loaded ? "opacity-100" : "opacity-0")}
              />
            )}
            {!loaded && <Spinner size={20} className="absolute text-muted" />}
            {images.length > 1 && (
              <>
                <button
                  aria-label={labels.prev}
                  onClick={() => go(-1)}
                  className="absolute left-5 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center border border-line2 bg-black/60 text-white transition-colors hover:border-white"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  aria-label={labels.next}
                  onClick={() => go(1)}
                  className="absolute right-5 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center border border-line2 bg-black/60 text-white transition-colors hover:border-white"
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>
          <div className="flex h-16 shrink-0 items-center justify-center px-8 text-center">
            <p className="selectable line-clamp-2 max-w-[760px] text-[13px] text-muted">{img?.description}</p>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
