// Kleine Pixel-Zeichen für die Loader (eigene Zeichnungen, keine Marken-Logos): Grasblock = Vanilla,
// Garnrolle = Fabric, Flicken = Quilt, Amboss = Forge, Amboss mit Funken = NeoForge. 12×12 Raster, scharf skaliert.
import { memo, type ReactElement } from "react";
import type { LoaderKind } from "@/lib/types";

type Art = { rows: string[]; colors: Record<string, string> };

const ART: Record<LoaderKind, Art> = {
  vanilla: {
    rows: [
      "GGGGGGGGGGGG",
      "GGgGGGGgGGGG",
      "gGGgGgGGGgGg",
      "dgddgdddgddd",
      "dddddDdddddd",
      "ddDddddddDdd",
      "dddddddddddd",
      "dDdddddDdddd",
      "ddddDddddddd",
      "dddddddddDdd",
      "dDdddddddddd",
      "dddddDdddddd",
    ],
    colors: { G: "#6fb34f", g: "#4f8c38", d: "#8b5e3c", D: "#6b462b" },
  },
  fabric: {
    rows: [
      "............",
      ".wwwwwwwwww.",
      ".WWWWWWWWWW.",
      "..ffffffff..",
      "..FfFfFfFf..",
      "..ffffffff..",
      "..FfFfFfFf..",
      "..ffffffff..",
      "..FfFfFfFf..",
      ".wwwwwwwwww.",
      ".WWWWWWWWWW.",
      "............",
    ],
    colors: { w: "#9a7650", W: "#6f5236", f: "#e6c9a0", F: "#c19d72" },
  },
  quilt: {
    rows: [
      "aaa.bbb.ccc.",
      "aaa.bbb.ccc.",
      "aaa.bbb.ccc.",
      "............",
      "bbb.ccc.aaa.",
      "bbb.ccc.aaa.",
      "bbb.ccc.aaa.",
      "............",
      "ccc.aaa.bbb.",
      "ccc.aaa.bbb.",
      "ccc.aaa.bbb.",
      "............",
    ],
    colors: { a: "#c796f9", b: "#9a6ce0", c: "#e6cdfd" },
  },
  forge: {
    rows: [
      "............",
      "............",
      "AAAAAAAAAAA.",
      ".aaaaaaaaaaa",
      "...aaaaaaaa.",
      ".....aaaa...",
      ".....aaaa...",
      "....aaaaaa..",
      "..aaaaaaaaaa",
      "..AAAAAAAAAA",
      "............",
      "............",
    ],
    colors: { a: "#8fa8ff", A: "#5f78d6" },
  },
  neoforge: {
    rows: [
      ".s.......s..",
      "...s..s.....",
      "AAAAAAAAAAA.",
      ".aaaaaaaaaaa",
      "...aaaaaaaa.",
      ".....aaaa...",
      ".....aaaa...",
      "....aaaaaa..",
      "..aaaaaaaaaa",
      "..AAAAAAAAAA",
      "............",
      "............",
    ],
    colors: { a: "#ff9a52", A: "#d06a26", s: "#ffd36b" },
  },
};

export const LoaderIcon = memo(function LoaderIcon({ loader, size = 24, className }: { loader: LoaderKind; size?: number; className?: string }) {
  const art = ART[loader];
  const rects: ReactElement[] = [];
  art.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = art.colors[row[x]];
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={c} />);
    }
  });
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" className={className} aria-hidden>
      {rects}
    </svg>
  );
});
