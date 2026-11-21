import { disc, recolor, slash, type Rows } from "./grid";

const camera: Rows = [
  "................",
  "................",
  "................",
  ".....ooooo......",
  ".oooooooooooooo.",
  ".ollllllllllhho.",
  ".olllloooollllo.",
  ".olllohaaaolllo.",
  ".ollloaaadolllo.",
  ".ollloaaddolllo.",
  ".olllloooollllo.",
  ".ollllllllllllo.",
  ".oooooooooooooo.",
  "................",
  "................",
  "................",
];

const film: Rows = [
  "................",
  "................",
  ".oooooooooooooo.",
  ".oaallaallaallo.",
  ".olaallaallaalo.",
  ".oooooooooooooo.",
  ".ollllllllllllo.",
  ".olllllallllllo.",
  ".olllllaalllllo.",
  ".olllllaaallllo.",
  ".olllllaalllllo.",
  ".olllllallllllo.",
  ".ollllllllllllo.",
  ".oooooooooooooo.",
  "................",
  "................",
];

const sparkle: Rows = [
  "................",
  "................",
  "......a.....h...",
  "......a....hhh..",
  "......a.....h...",
  ".....aha........",
  ".....aaa........",
  "....aaaaa.......",
  ".aaaaahaaaaa....",
  "....aaaaa.......",
  ".....aaa........",
  ".....aaa.....h..",
  "......a.....hhh.",
  "......a......h..",
  "......a.........",
  "................",
];

const globe = disc([
  "laaall",
  "lhaaaaalll",
  "laaaaaalllll",
  "llaaaallllll",
  "lllaalllaaal",
  "llllalllaaaa",
  "lllllllaaaaa",
  "llllllllaaaa",
  "llaaallllaal",
  "llaaaallllll",
  "laaallllll",
  "llllll",
]);

const compass = disc([
  "llllll",
  "llllllllll",
  "lllllllllall",
  "llllllllaall",
  "lllllllhaall",
  "llllloaaalll",
  "lllmmmolllll",
  "llmmmlllllll",
  "llmmllllllll",
  "llmlllllllll",
  "llllllllll",
  "llllll",
]);

const clock = disc([
  "llllll",
  "llllmmllll",
  "lllllallllll",
  "lllllallllll",
  "lllllallllll",
  "lllllaaaalll",
  "mllllllllllm",
  "llllllllllll",
  "llllllllllll",
  "llllllllllll",
  "llllmmllll",
  "llllll",
]);

export const MEDIA_MOTIFS = {
  camera,
  film,
  film_off: slash(recolor(film, { a: "m", h: "m" })),
  sparkle,
  globe,
  compass,
  clock,
} satisfies Record<string, Rows>;
