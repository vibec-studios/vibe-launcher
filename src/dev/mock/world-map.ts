import type { MapOverview, MapSource, MapWaypoint } from "@/features/instances/map/api";
import type { Handlers } from "./util";

const OVERWORLD = "minecraft:overworld";
const NETHER = "minecraft:the_nether";

const sources: MapSource[] = [
  { id: "xaero:0:Neue Welt", kind: "xaero", world: "Neue Welt", multiplayer: false, name: "Neue Welt", servers: [], dimensions: [OVERWORLD, NETHER], modified: 3 },
  { id: "journeymap:2:Neue Welt", kind: "journeymap", world: "Neue Welt", multiplayer: false, name: "Neue Welt", servers: [], dimensions: [OVERWORLD], modified: 2 },
  {
    id: "xaero:0:Multiplayer_smp.vibecraft.de",
    kind: "xaero",
    world: "Multiplayer_smp.vibecraft.de",
    multiplayer: true,
    name: "smp.vibecraft.de",
    servers: ["smp.vibecraft.de"],
    dimensions: [OVERWORLD, NETHER, "minecraft:the_end"],
    modified: 1,
  },
];

const waypoints: MapWaypoint[] = [
  { name: "Zuhause", initials: "Z", x: 40, y: 72, z: -25, color: "#ffaa00", death: false },
  { name: "Dorf", initials: "D", x: -610, y: 68, z: 340, color: "#55ff55", death: false },
  { name: "Mine", initials: "M", x: 380, y: 12, z: 560, color: "#5555ff", death: false },
  { name: "Tod", initials: "X", x: 900, y: 64, z: -700, color: "#aa0000", death: true },
];

const cancelled = new Set<string>();

function regions(dimension: string): [number, number][] {
  const out: [number, number][] = [];
  const span = dimension === OVERWORLD ? 3 : 1;
  for (let z = -span; z <= span; z++) for (let x = -span; x <= span; x++) if ((x * 7 + z * 3) % 5 !== 4) out.push([x, z]);
  return out;
}

function terrain(x: number, z: number, nether: boolean) {
  const h = Math.sin(x / 97) * 30 + Math.cos(z / 83) * 26 + Math.sin((x + z) / 41) * 12 + Math.cos((x - z) / 23) * 6;
  if (nether) return h > 18 ? [231, 105, 30] : h > -12 ? [125, 52, 54] : [85, 65, 55];
  if (h < -22) return [54, 112, 182];
  if (h < -17) return [216, 203, 154];
  if (h > 40) return [237, 246, 250];
  if (h > 26) return [133, 137, 139];
  return (x * 13 + z * 7) % 9 === 0 ? [63, 119, 57] : [107, 152, 66];
}

function tileImage(rx: number, rz: number, lod: number, nether: boolean) {
  const side = 512 / lod;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(side, side);
  for (let pz = 0; pz < side; pz++) {
    for (let px = 0; px < side; px++) {
      const bx = rx * 512 + px * lod;
      const bz = rz * 512 + pz * lod;
      const explored = Math.hypot(bx + 200, bz - 100) < 1500 - 220 * Math.sin(bx / 300 + bz / 400);
      if (!explored) continue;
      const [r, g, b] = terrain(bx, bz, nether);
      const shade = 1 + Math.sin(bx / 11) * 0.04;
      const i = (pz * side + px) * 4;
      image.data[i] = Math.min(255, r * shade);
      image.data[i + 1] = Math.min(255, g * shade);
      image.data[i + 2] = Math.min(255, b * shade);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1];
}

const handlers: Handlers = {
  world_map_sources: () => sources,
  world_map_overview: async ({ source, dimension }) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const found = sources.find((candidate) => candidate.id === source);
    if (!found || !found.dimensions.includes(String(dimension)) || dimension === "minecraft:the_end") return null;
    const overview: MapOverview = {
      layer: found.kind === "xaero" ? `${dimension === NETHER ? "DIM-1" : "null"}/mw$default` : "overworld/day",
      cave: dimension === NETHER,
      regions: regions(String(dimension)),
      truncated: false,
      latest: [0, 0],
      waypoints: found.kind === "xaero" && dimension === OVERWORLD ? waypoints : [],
    };
    return overview;
  },
  world_map_waypoints: ({ world, dimension }) => (world === "Neue Welt" && dimension === OVERWORLD ? waypoints.slice(0, 2) : []),
  world_map_tile: async ({ x, z, lod, layer, session }) => {
    await new Promise((resolve) => setTimeout(resolve, 60 + Math.random() * 120));
    if (cancelled.has(String(session))) throw { kind: "cancelled" };
    const png = tileImage(Number(x), Number(z), Number(lod), String(layer).startsWith("DIM-1"));
    return { png, lod };
  },
  world_map_cancel: ({ session }) => {
    cancelled.add(String(session));
  },
};

export default handlers;
