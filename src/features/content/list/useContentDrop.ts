import { useEffect, useId, useMemo, useRef } from "react";
import type { ContentKind } from "@/lib/types";
import { registerDropTarget, useDragState } from "@/components/content/dragdrop";
import { fileExt } from "@/components/content/util";
import { addContentFiles } from "../addContentFiles";
import type { TypeFilter } from "./keys";

export function useContentDrop(id: string, type: TypeFilter, vanilla: boolean) {
  // ---------------------------------------------------------------- Drag & Drop auf die Liste
  const zipKind: ContentKind = type === "shader" ? "shader" : "resourcepack";
  const dropKinds = useMemo<ContentKind[]>(() => (type === "all" ? (vanilla ? ["resourcepack"] : ["mod", "resourcepack"]) : [type]), [type, vanilla]);
  const dropId = useId();
  const dropRef = useRef<HTMLDivElement>(null);
  const over = useDragState((s) => s.over === dropId);
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const kindFor = (p: string): ContentKind | null => {
      const ext = fileExt(p);
      if (ext === "jar") return dropKinds.includes("mod") ? "mod" : null;
      if (ext === "zip") return dropKinds.includes(zipKind) || type === "all" ? zipKind : null;
      return null;
    };
    return registerDropTarget({
      id: dropId,
      el,
      accepts: (paths) => paths.some((p) => kindFor(p) !== null),
      onDrop: (paths) => {
        for (const k of ["mod", "resourcepack", "shader"] as ContentKind[]) {
          const mine = paths.filter((p) => kindFor(p) === k);
          if (mine.length) void addContentFiles(id, k, mine);
        }
      },
    });
  }, [dropId, id, dropKinds, zipKind, type]);

  return { zipKind, dropKinds, dropRef, over };
}
