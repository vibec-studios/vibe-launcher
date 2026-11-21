import { memo } from "react";
import { PixelBlock, SnowCap, useSnow } from "./LegacyBlock";
import { toPaths, type Grid } from "./texture";
import type { Design, FlatDesign, IsoDesign } from "./types";

function Face({ g, palette, m }: { g: Grid; palette: string[]; m: [number, number, number, number, number, number] }) {
  const paths = toPaths(g);
  const k = 1 / g.n;
  const opaqueBase = palette[0]?.startsWith("#");
  return (
    <g transform={`matrix(${m[0] * k} ${m[1] * k} ${m[2] * k} ${m[3] * k} ${m[4]} ${m[5]})`}>
      {opaqueBase && <rect width={g.n} height={g.n} fill={palette[0]} />}
      {paths.map((d, i) => (d && !(i === 0 && opaqueBase) ? <path key={i} d={d} fill={palette[i] ?? palette[0]} /> : null))}
    </g>
  );
}

function Iso({ design, accent, size }: { design: IsoDesign; accent: string; size: number }) {
  const snow = useSnow();
  const { top, side, front } = design.faces();
  const palette = design.palette(accent);
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden className="block">
      <Face g={top} palette={palette} m={[14, 7, -14, 7, 16, 2]} />
      <Face g={side} palette={palette} m={[14, 7, 0, 14, 2, 9]} />
      <Face g={front ?? side} palette={palette} m={[14, -7, 0, 14, 16, 16]} />
      <path fill="#fff" fillOpacity={0.06} d="M16 2 30 9 16 16 2 9z" />
      <path fill="#000" fillOpacity={0.32} d="M2 9 16 16v14L2 23z" />
      <path fill="#000" fillOpacity={0.12} d="M30 9 16 16v14l14-7z" />
      <path fill="none" stroke="#fff" strokeOpacity={0.22} strokeWidth={0.5} d="M2.2 9.1 16 16 29.8 9.1M16 16v13.8" />
      {snow && <SnowCap />}
    </svg>
  );
}

function Flat({ design, accent, size, cover }: { design: FlatDesign; accent: string; size: number; cover?: boolean }) {
  const g = design.grid();
  const palette = design.palette(accent);
  const paths = toPaths(g);
  return (
    <svg
      viewBox={`0 0 ${g.n} ${g.n}`}
      width={cover ? "100%" : size}
      height={cover ? "100%" : size}
      preserveAspectRatio={cover ? "xMidYMid slice" : undefined}
      shapeRendering="crispEdges"
      aria-hidden
      className={cover ? "absolute inset-0 block" : "block"}
    >
      {paths.map((d, i) => (d ? <path key={i} d={d} fill={palette[i]} /> : null))}
    </svg>
  );
}

export const BlockArt = memo(function BlockArt({ design, accent, size, cover }: { design: Design; accent: string; size: number; cover?: boolean }) {
  if (design.kind === "flat") return <Flat design={design} accent={accent} size={design.fill ? size : Math.round(size * 0.72)} cover={cover && design.fill} />;
  if (design.legacy) return <PixelBlock color={accent} size={Math.round(size * 0.66)} />;
  return <Iso design={design} accent={accent} size={Math.round(size * 0.68)} />;
});
