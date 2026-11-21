import { shade } from "./color";
import { lazy, paint, rng, rows, speckle, spots, stamp, type Grid } from "./texture";
import type { DesignGroup, Faces, IsoDesign } from "./types";

const STONE = ["#8b8b8b", "#7b7b7b", "#9c9c9c", "#6a6a6a"];
const STONE_W = [5, 3, 2, 1.2];
const DIRT = ["#8a5a36", "#734a2b", "#9d6b43", "#5f3b21"];
const GRASS = ["#5f9e3a", "#4e8a2f", "#73b447", "#3f7427"];
const PLANK = ["#b08850", "#9b7644", "#c39b5d", "#6f5230"];

function iso(id: string, group: DesignGroup, palette: string[] | ((a: string) => string[]), faces: () => Faces, opts: { tint?: boolean; legacy?: boolean } = {}): IsoDesign {
  return { kind: "iso", id, group, palette: typeof palette === "function" ? palette : () => palette, faces: lazy(faces), ...opts };
}

function same(g: Grid): Faces {
  return { top: g, side: g };
}

function flipX(g: Grid): Grid {
  return paint(g, (x, y) => g.px[y * g.n + (g.n - 1 - x)]);
}

function shift(g: Grid, by: number): Grid {
  return paint(g, (_x, _y, c) => (c < 0 ? c : c + by));
}

function fringe(base: Grid, top: Grid, seed: number, by: number): Grid {
  const r = rng(seed);
  return paint(base, (x, y, c) => {
    const v = r();
    const g = top.px[y * top.n + x] + by;
    if (y === 0) return g;
    if (y === 1) return v < 0.7 ? g : c;
    if (y === 2) return v < 0.22 ? g : c;
    return c;
  });
}

function ore(seed: number): Grid {
  return stamp(speckle(8, seed, STONE_W), spots(seed + 7, 8, 3, 3, 4));
}

function oreDesign(id: string, colors: string[], seed: number): IsoDesign {
  return iso(id, "ore", [...STONE, ...colors], () => ({ top: ore(seed), side: ore(seed + 1), front: ore(seed + 2) }));
}

function stripesV(seed: number, dark: number, light: number, rare: number): Grid {
  const r = rng(seed);
  return paint(rows(Array(8).fill("00000000")), (x) => {
    const v = r();
    if (v < 0.1) return rare;
    return x % 3 === 0 ? dark : x % 3 === 2 && v < 0.6 ? light : 0;
  });
}

const RINGS = ["00000000", "04444440", "04555540", "04566540", "04566540", "04555540", "04444440", "00000000"];

function planks(seed: number): Grid {
  const r = rng(seed);
  return paint(rows(Array(8).fill("00000000")), (x, y) => {
    if (y === 3 || y === 7) return 3;
    if ((y < 3 && x === 5) || (y > 3 && y < 7 && x === 1)) return 3;
    const v = r();
    return v < 0.2 ? 1 : v < 0.32 ? 2 : 0;
  });
}

function bricks(seed: number): Grid {
  const r = rng(seed);
  return paint(rows(Array(8).fill("00000000")), (x, y) => {
    if (y % 4 === 3 || x === (y < 4 ? 3 : 7)) return 3;
    const v = r();
    return v < 0.25 ? 1 : v < 0.4 ? 2 : 0;
  });
}

const tinted = (a: string) => [a, shade(a, -0.14), shade(a, 0.16), shade(a, -0.3), shade(a, 0.45)];

export const ISO_DESIGNS: IsoDesign[] = [
  iso("grass", "nature", [...DIRT, ...GRASS], () => {
    const top = speckle(8, 11, [5, 3, 2, 1]);
    return { top: shift(top, 4), side: fringe(speckle(8, 12, [5, 3, 2, 1.4]), top, 13, 4), front: fringe(speckle(8, 14, [5, 3, 2, 1.4]), top, 15, 4) };
  }),
  iso("dirt", "nature", DIRT, () => ({ top: speckle(8, 21, [5, 3, 2, 1.4]), side: speckle(8, 22, [5, 3, 2, 1.4]), front: speckle(8, 23, [5, 3, 2, 1.4]) })),
  iso("stone", "nature", STONE, () => ({ top: speckle(8, 31, STONE_W), side: speckle(8, 32, STONE_W), front: speckle(8, 33, STONE_W) })),
  iso("cobble", "build", ["#8a8a8a", "#a3a3a3", "#6e6e6e", "#4f4f4f"], () => {
    const g = rows(["11300113", "10230123", "33013333", "10011012", "02331003", "33003330", "01130110", "30123300"]);
    return { top: g, side: flipX(g), front: g };
  }),
  iso("deepslate", "nature", ["#4d4d55", "#424249", "#5a5a63", "#36363c"], () => {
    const r = rng(41);
    const side = paint(speckle(8, 42, [5, 3, 2, 1]), (_x, y, c) => (y % 3 === 2 && r() < 0.6 ? 3 : c));
    return { top: speckle(8, 43, [5, 3, 2, 1.5]), side, front: flipX(side) };
  }),
  oreDesign("coal", ["#2b2b2b", "#4a4a4a", "#1a1a1a"], 51),
  oreDesign("iron", ["#d8af93", "#ecd2bf", "#a87e62"], 61),
  oreDesign("gold", ["#f5d142", "#fff3a0", "#c99a1e"], 71),
  oreDesign("diamond", ["#4fe3d8", "#bdfbf5", "#1fa59b"], 81),
  oreDesign("emerald", ["#2fd36b", "#a6f5c2", "#178a44"], 91),
  oreDesign("ruby", ["#e0313f", "#ff9aa2", "#8f1520"], 101),
  oreDesign("sapphire", ["#3a63d8", "#9db6ff", "#1d3590"], 111),
  iso("log", "nature", ["#6b4f2f", "#5a4024", "#7e5e38", "#46311b", "#b8915a", "#9c7745", "#cba46a"], () => {
    const side = stripesV(121, 1, 2, 3);
    return { top: rows(RINGS), side, front: flipX(side) };
  }),
  iso("birch", "nature", ["#e6e2d6", "#d3cebf", "#f4f1e8", "#2e2b28", "#d8c49a", "#bfa97c", "#e5d4ac"], () => {
    const marks: [number, number, number][] = [[1, 1, 3], [2, 1, 3], [5, 3, 3], [6, 3, 3], [7, 3, 3], [0, 5, 3], [3, 6, 3], [4, 6, 3]];
    const side = stamp(speckle(8, 131, [6, 2, 2]), marks);
    return { top: rows(RINGS), side, front: flipX(side) };
  }),
  iso("planks", "build", PLANK, () => ({ top: planks(141), side: planks(142), front: planks(143) })),
  iso("leaves", "nature", ["#3f7d2a", "#346b22", "#4f9435", "#28521a"], () => ({ top: speckle(8, 151, [4, 3, 2, 2]), side: speckle(8, 152, [4, 3, 2, 2]), front: speckle(8, 153, [4, 3, 2, 2]) })),
  iso("sand", "nature", ["#dfd19f", "#d2c48e", "#e9dfb2", "#c4b47c"], () => ({ top: speckle(8, 161, [5, 3, 2, 1]), side: speckle(8, 162, [5, 3, 2, 1]), front: speckle(8, 163, [5, 3, 2, 1]) })),
  iso("gravel", "nature", ["#857f7a", "#6f6a66", "#9d9690", "#58534f", "#b0a8a1"], () => ({ top: speckle(8, 171, [3, 3, 2, 2, 1]), side: speckle(8, 172, [3, 3, 2, 2, 1]), front: speckle(8, 173, [3, 3, 2, 2, 1]) })),
  iso("glass", "build", ["rgba(200,235,250,.28)", "#e4f6fc", "#ffffff", "#a8d4e6"], () => {
    const g = rows(["31111113", "10000001", "10020001", "10200001", "12000201", "10002001", "10020001", "31111113"]);
    return { top: g, side: g, front: flipX(g) };
  }),
  iso("bricks", "build", ["#9c4a3b", "#873f32", "#b0594a", "#cdbfb2"], () => ({ top: bricks(181), side: bricks(182), front: bricks(183) })),
  iso("quartz", "build", ["#ece6dc", "#ddd6ca", "#f7f3ec", "#cbc3b5"], () => {
    const g = paint(speckle(8, 191, [8, 2, 2]), (x, y, c) => (x === 0 || y === 7 ? 3 : x === 7 || y === 0 ? 2 : c));
    return same(g);
  }),
  iso("netherrack", "special", ["#6f2b2b", "#5b2121", "#853636", "#491818", "#9a4040"], () => ({ top: speckle(8, 201, [4, 3, 2, 2, 1]), side: speckle(8, 202, [4, 3, 2, 2, 1]), front: speckle(8, 203, [4, 3, 2, 2, 1]) })),
  iso("magma", "special", ["#3d1b0f", "#2b130a", "#4d2414", "#ff7a1a", "#ffbf3a"], () => {
    const g = rows(["00030000", "10034001", "00300430", "23001003", "30010030", "03402300", "00430030", "10030100"]);
    return { top: g, side: flipX(g), front: g };
  }),
  iso("endstone", "special", ["#dfdc9f", "#d0cd8c", "#eae8b3", "#bebb7b"], () => ({ top: speckle(8, 221, [5, 3, 2, 1.5]), side: speckle(8, 222, [5, 3, 2, 1.5]), front: speckle(8, 223, [5, 3, 2, 1.5]) })),
  iso("obsidian", "special", ["#1e1531", "#150e24", "#2b1e46", "#4a3478"], () => ({ top: speckle(8, 231, [5, 4, 2, 0.6]), side: speckle(8, 232, [5, 4, 2, 0.6]), front: speckle(8, 233, [5, 4, 2, 0.6]) })),
  iso("glowstone", "special", ["#e8b84a", "#c9922a", "#ffd970", "#8f5f1a", "#fff3b0"], () => ({ top: speckle(8, 241, [3, 3, 2, 1, 1]), side: speckle(8, 242, [3, 3, 2, 1, 1]), front: speckle(8, 243, [3, 3, 2, 1, 1]) })),
  iso("workbench", "build", [...PLANK.slice(0, 1), "#6f5230", "#c39b5d", "#9a9a9a", "#5a4024", "#8a6a3e"], () => {
    const top = rows(["11111111", "10021001", "12001201", "11111111", "10201021", "10012001", "12001201", "11111111"]);
    const side = rows(["11111111", "55555555", "00300040", "03330040", "00400040", "00400333", "00400030", "11111111"]);
    return { top, side, front: flipX(side) };
  }),
  iso("crate", "special", ["#c8352b", "#9c2620", "#ece6dc", "#2a2a2a", "#de4a3e", "#8a8a8a"], () => {
    const side = rows(["01401401", "01401401", "22222222", "23223232", "23223322", "22222222", "01401401", "01401401"]);
    const top = rows(["10000001", "04000040", "00011000", "00135100", "00153100", "00011000", "04000040", "10000001"]);
    return { top, side, front: flipX(side) };
  }),
  iso("pumpkin", "nature", ["#d9822b", "#bf6c1e", "#ec9a40", "#8f4f12", "#5d7a2a", "#3a1f08", "#ffcf4a"], () => {
    const side = paint(rows(Array(8).fill("00000000")), (x, y) => (y === 0 || y === 7 ? (x % 4 === 0 ? 3 : 1) : x % 4 === 0 ? 1 : x % 4 === 2 ? 2 : 0));
    const top = rows(["10200201", "02000020", "20044002", "00444400", "00444400", "20044002", "02000020", "10200201"]);
    const front = rows(["10201020", "06610660", "06610660", "10020100", "06666660", "16066061", "10600601", "10201020"]);
    return { top, side, front };
  }),
  iso("bookshelf", "build", [...PLANK.slice(0, 1), "#6f5230", "#c39b5d", "#a83a3a", "#3a5fa8", "#4f8f3a", "#c9a33b", "#7a4fa8"], () => {
    const side = rows(["22222222", "13457361", "13457361", "11111111", "16374531", "16374531", "11111111", "22222222"]);
    return { top: paint(planks(251), (_x, _y, c) => (c === 3 ? 1 : c === 1 ? 0 : c)), side, front: flipX(side) };
  }),
  iso("hay", "nature", ["#cfa935", "#b8942a", "#e0bd4a", "#7a5a1e", "#a07a22"], () => {
    const r = rng(261);
    const side = paint(rows(Array(8).fill("00000000")), (x, y) => (y === 1 || y === 6 ? 3 : x % 2 === 0 ? (r() < 0.3 ? 2 : 0) : r() < 0.3 ? 4 : 1));
    const top = rows(["01020102", "10333301", "03100130", "03122130", "03122130", "03100130", "10333301", "20102010"]);
    return { top, side, front: flipX(side) };
  }),
  iso("cactus", "nature", ["#4f8a2f", "#3d6e24", "#62a03c", "#d9e6a0", "#2c5219"], () => {
    const base = paint(rows(Array(8).fill("00000000")), (x) => (x === 0 || x === 7 ? 4 : x === 2 || x === 5 ? 1 : x === 3 ? 2 : 0));
    const side = stamp(base, [[1, 2, 3], [6, 1, 3], [4, 4, 3], [6, 6, 3], [1, 6, 3]]);
    const top = rows(["44444444", "40000004", "40222204", "40211204", "40211204", "40222204", "40000004", "44444444"]);
    return { top, side, front: flipX(side) };
  }),
  iso("mushroom", "nature", ["#c0392b", "#a83224", "#d64a3b", "#f3e7d8"], () => {
    const dots: [number, number, number][] = [[1, 1, 3], [2, 1, 3], [1, 2, 3], [2, 2, 3], [5, 4, 3], [6, 4, 3], [5, 5, 3], [6, 5, 3], [2, 6, 3], [6, 1, 3]];
    const g = stamp(speckle(8, 271, [5, 2, 2]), dots);
    return { top: g, side: flipX(g), front: g };
  }),
  iso("ice", "nature", ["#9cc6f3", "#89b6ea", "#b4d6f8", "#e3f1ff"], () => {
    const cracks: [number, number, number][] = [[1, 1, 3], [2, 2, 3], [3, 2, 3], [4, 3, 3], [5, 5, 3], [6, 6, 3], [6, 7, 3], [6, 1, 3]];
    const g = stamp(speckle(8, 281, [5, 3, 2]), cracks);
    return { top: g, side: flipX(g), front: g };
  }),
  iso("snow", "nature", ["#f2f6fa", "#e3ebf2", "#ffffff", "#d2dde8"], () => ({ top: speckle(8, 291, [5, 3, 3, 1]), side: speckle(8, 292, [5, 3, 3, 1]), front: speckle(8, 293, [5, 3, 3, 1]) })),
  iso("moss", "nature", ["#5b7e2b", "#4b6c22", "#6f9435", "#3d5a1b", "#83a843"], () => ({ top: speckle(8, 301, [4, 3, 2, 2, 1]), side: speckle(8, 302, [4, 3, 2, 2, 1]), front: speckle(8, 303, [4, 3, 2, 2, 1]) })),
  iso("amethyst", "special", ["#8e5fc9", "#7a4db3", "#a97be0", "#5f3a91", "#d2b1f5"], () => {
    const g = rows(["02240131", "22401313", "24013130", "40131302", "01313024", "13130240", "31302401", "13024013"]);
    return { top: g, side: g, front: flipX(g) };
  }),
  iso("copper", "build", ["#c26b46", "#a8583a", "#d9845a", "#8c482e", "#5fb89a", "#4a9a80"], () => {
    const patina: [number, number, number][] = [[0, 0, 4], [1, 0, 5], [0, 1, 4], [6, 5, 4], [7, 5, 4], [6, 6, 5], [3, 7, 4], [4, 7, 4]];
    const g = stamp(speckle(8, 311, [4, 3, 2, 1]), patina);
    return { top: g, side: flipX(g), front: g };
  }),
  iso("honeycomb", "nature", ["#e8a33a", "#c9822a", "#f5c25a", "#9a5f1a"], () => {
    const g = rows(["31122113", "12000021", "20022002", "20022002", "12000021", "31122113", "13300331", "33100133"]);
    return { top: g, side: flipX(g), front: g };
  }),
  iso("prismarine", "special", ["#5fa898", "#4c8f80", "#73bfae", "#3a7468", "#8fd6c6"], () => ({ top: speckle(8, 321, [4, 3, 2, 2, 1]), side: speckle(8, 322, [4, 3, 2, 2, 1]), front: speckle(8, 323, [4, 3, 2, 2, 1]) })),
  iso("wool", "special", tinted, () => ({ top: speckle(8, 331, [5, 3, 2, 1]), side: speckle(8, 332, [5, 3, 2, 1]), front: speckle(8, 333, [5, 3, 2, 1]) }), { tint: true }),
  iso("crystal", "special", tinted, () => {
    const g = rows(["33122133", "31244213", "12400421", "24000042", "24000042", "12400421", "31244213", "33122133"]);
    return same(g);
  }, { tint: true }),
  iso("cube", "special", tinted, () => same(rows(["0"])), { tint: true, legacy: true }),
];
