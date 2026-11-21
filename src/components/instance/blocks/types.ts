import type { Grid } from "./texture";

export type DesignGroup = "nature" | "ore" | "build" | "special" | "pattern" | "symbol";

export interface Faces {
  top: Grid;
  side: Grid;
  front?: Grid;
}

export interface IsoDesign {
  kind: "iso";
  id: string;
  group: DesignGroup;
  tint?: boolean;
  legacy?: boolean;
  palette: (accent: string) => string[];
  faces: () => Faces;
}

export interface FlatDesign {
  kind: "flat";
  id: string;
  group: DesignGroup;
  tint?: boolean;
  fill: boolean;
  palette: (accent: string) => string[];
  grid: () => Grid;
}

export type Design = IsoDesign | FlatDesign;
