// Beschreibungen/Changelogs aus dem Netz: Markdown (Modrinth) oder HTML (CurseForge) – IMMER mit DOMPurify bereinigt.
// Bilder lazy, Links extern (Klick-Guard öffnet https-Links im Systembrowser), nur YouTube-iframes (nocookie).
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { memo, useMemo } from "react";
import { cn } from "@/components/ui";
import "./prose.css";

const marked = new Marked({ gfm: true, breaks: false, async: false });

const purify = DOMPurify(window);
const YT = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)\/embed\/([\w-]+)([?#].*)?$/i;

/** CurseForge-"linkout"-Links auflösen (doppelt URL-kodiert). */
function resolveHref(href: string): string | null {
  const m = /linkout\?remoteUrl=([^&]+)/i.exec(href);
  if (m) {
    try {
      href = decodeURIComponent(decodeURIComponent(m[1]));
    } catch {
      return null;
    }
  }
  if (href.startsWith("//")) href = "https:" + href;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("#")) return null;
  return null;
}

purify.addHook("afterSanitizeAttributes", (node) => {
  const el = node as Element;
  const tag = el.tagName?.toLowerCase();
  if (tag === "a") {
    const href = resolveHref(el.getAttribute("href") ?? "");
    if (href) {
      el.setAttribute("href", href);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    } else {
      el.removeAttribute("href");
    }
  } else if (tag === "img") {
    let src = el.getAttribute("src") ?? "";
    if (src.startsWith("//")) src = "https:" + src;
    if (!/^https:\/\//i.test(src) && !src.startsWith("data:image/")) {
      el.remove();
      return;
    }
    el.setAttribute("src", src);
    el.setAttribute("loading", "lazy");
    el.setAttribute("decoding", "async");
    el.setAttribute("draggable", "false");
    el.removeAttribute("srcset");
  } else if (tag === "iframe") {
    const m = YT.exec(el.getAttribute("src") ?? "");
    if (!m) {
      el.remove();
      return;
    }
    {
      el.setAttribute("src", `https://www.youtube-nocookie.com/embed/${m[1]}${m[2] ?? ""}`);
      el.setAttribute("loading", "lazy");
      el.setAttribute("allow", "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen");
      el.setAttribute("allowfullscreen", "");
      el.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      el.removeAttribute("width");
      el.removeAttribute("height");
      el.removeAttribute("style");
    }
  }
});

export function sanitize(source: string, format: "markdown" | "html"): string {
  const html = format === "markdown" ? (marked.parse(source) as string) : source;
  return purify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "target", "loading", "referrerpolicy"],
    FORBID_TAGS: ["style", "script", "form", "input", "button", "textarea", "select", "object", "embed"],
    FORBID_ATTR: ["style", "onerror", "onload", "class", "id"],
  });
}

/** Bereinigter Rich-Text im Launcher-Look. Markierbar (`.selectable`). */
export const RichText = memo(function RichText({
  source,
  format,
  className,
  compact,
}: {
  source: string;
  format: "markdown" | "html";
  className?: string;
  compact?: boolean;
}) {
  const html = useMemo(() => sanitize(source, format), [source, format]);
  return <div className={cn("vl-prose selectable", compact && "vl-prose-compact", className)} dangerouslySetInnerHTML={{ __html: html }} />;
});
