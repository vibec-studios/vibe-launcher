// 3D-Vorschau von `.vibey`-Bundles (Vibey Client) in three.js – am Spieler mit dem echten Skin.
// Portiert aus dem Website-Viewer (vibec-studios.github.io/js/vibey3d.js, selbst aus dem Software-Renderer des
// vibey-client-Repos), damit Geometrie, UVs und Animationen exakt den Regeln aus SPEC §5 folgen:
// - `.vibey` liegt im Blockbench-Raum (Füße im Ursprung, +Y oben, Spieler schaut nach −Z, rechter Arm bei +X);
//   Modellraum wie Vanilla: x' = −x, y' = 24 − y, z' = z; Rotationen −rx, −ry, rz in Z·Y·X-Reihenfolge.
// - Keyframes nach Blockbench (linear, step, catmullrom mit Split-Keys `pre` und Umbruch bei Schleifen).
// - Animierte Texturen wie .mcmeta (frameTime in Ticks, Reihenfolge, optional überblendet).
// Erweiterungen gegenüber der Website: mehrere Bundles gleichzeitig (ganzes Loadout + Emote), echter Skin mit
// Overlay-Schicht und schmalen Armen, Gehen-Pose, Vorschaubilder (Offscreen).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ------------------------------------------------------------------------------------------------ Typen (Bundle)
type V3 = [number, number, number];
type M4 = number[];

export interface Keyframe {
  t: number;
  v: V3;
  pre?: V3;
  i?: "linear" | "catmullrom" | "step" | "bezier";
}
export interface VibeyAnimation {
  length: number;
  loop?: boolean;
  bones?: Record<string, { rotation?: Keyframe[]; position?: Keyframe[]; scale?: Keyframe[] }>;
  events?: Array<{ t: number; type: string; [k: string]: any }>;
}
interface Cube {
  from: V3;
  to: V3;
  inflate?: number;
  mirror?: boolean;
  pivot?: V3;
  rotation?: V3;
  texture?: string;
  uv?: { box?: [number, number] } & Partial<Record<FaceName, [number, number, number, number] | { uv?: [number, number, number, number]; texture?: string }>>;
}
interface Bone {
  name: string;
  parent?: string | null;
  attach?: string;
  pivot?: V3;
  rotation?: V3;
  cubes?: Cube[];
  emissive?: boolean;
  translucent?: boolean;
}
export interface VibeyJson {
  format: "vibey";
  formatVersion: number;
  kind: "cosmetic" | "emote";
  id: string;
  name: { en: string; de?: string };
  description?: { en?: string; de?: string };
  author?: string;
  tags?: string[];
  rarity?: string;
  cosmetic?: { slot: string; cape?: { texture: string }; shield?: { texture: string }; pet?: { scale?: number; follow?: string }; [k: string]: any };
  emote?: { animation: string; loop?: boolean; [k: string]: any };
  textures?: Array<{ id: string; width: number; height: number; png: string; animation?: { frameTime?: number; frames?: number[]; interpolate?: boolean } }>;
  model?: { texture?: string; bones: Bone[]; locators?: Record<string, { bone: string; position?: V3 }> };
  animations?: Record<string, VibeyAnimation>;
  sprites?: Array<{ id: string; texture: string; uv: [number, number, number, number] }>;
}

interface Tex {
  id: string;
  w: number;
  h: number;
  img: HTMLImageElement;
  pxW: number;
  pxH: number;
  tex: THREE.CanvasTexture;
  tick: (time: number) => void;
}

export interface Bundle {
  json: VibeyJson;
  tex: Map<string, Tex>;
  bones: Map<string, Bone>;
  sprites: Map<string, { id: string; texture: string; uv: [number, number, number, number] }>;
  locators: Record<string, { bone: string; position?: V3 }>;
}

// ------------------------------------------------------------------------------------------------ Mathematik (zeilenweise 4×4)
const mul = (a: M4, b: M4): M4 => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
};
const T = (x: number, y: number, z: number): M4 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const S = (x: number, y = x, z = x): M4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const Rx = (a: number): M4 => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
};
const Ry = (a: number): M4 => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
};
const Rz = (a: number): M4 => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};
const Rzyx = (x: number, y: number, z: number) => mul(mul(Rz(z), Ry(y)), Rx(x));
const apply = (m: M4, p: number[]): V3 => [0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]) as V3;
const applyDir = (m: M4, p: number[]): V3 => [0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2]) as V3;
const sub = (a: number[], b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const deg = (d: number) => (d * Math.PI) / 180;

const WORLD: M4 = [1, 0, 0, 0, 0, -1, 0, 24, 0, 0, -1, 0, 0, 0, 0, 1];
const mcPos = (p: number[]): V3 => [-p[0], 24 - p[1], p[2]];
const mcOff = (p: number[]): V3 => [-p[0], -p[1], p[2]];
const mcRot = (r: number[]): V3 => [deg(-r[0]), deg(-r[1]), deg(r[2])];

/** Spieler in Blockbench-Koordinaten (SPEC §5), Skin im modernen 64×64-Layout. `ov` = Overlay-UV, `inf` = Overlay-Abstand. */
function playerParts(slim: boolean) {
  const a = slim ? 3 : 4;
  return [
    { name: "head", pivot: [0, 24, 0], from: [-4, 24, -4], to: [4, 32, 4], uv: [0, 0], ov: [32, 0], inf: 0.5 },
    { name: "body", pivot: [0, 24, 0], from: [-4, 12, -2], to: [4, 24, 2], uv: [16, 16], ov: [16, 32], inf: 0.25 },
    { name: "right_arm", pivot: [5, 22, 0], from: [4, 12, -2], to: [4 + a, 24, 2], uv: [40, 16], ov: [40, 32], inf: 0.25 },
    { name: "left_arm", pivot: [-5, 22, 0], from: [-4 - a, 12, -2], to: [-4, 24, 2], uv: [32, 48], ov: [48, 48], inf: 0.25 },
    { name: "right_leg", pivot: [1.9, 12, 0], from: [-0.1, 0, -2], to: [3.9, 12, 2], uv: [0, 16], ov: [0, 32], inf: 0.25 },
    { name: "left_leg", pivot: [-1.9, 12, 0], from: [-3.9, 0, -2], to: [0.1, 12, 2], uv: [16, 48], ov: [0, 48], inf: 0.25 },
  ] as const;
}
const PLAYER_NAMES = ["head", "body", "right_arm", "left_arm", "right_leg", "left_leg"];

// ------------------------------------------------------------------------------------------------ Animation
function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t,
    t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Kanal abtasten nach Blockbench-Regeln. */
function sampleChannel(keys: Keyframe[] | undefined, t: number, loop = false): V3 | null {
  if (!keys?.length) return null;
  const n = keys.length;
  const pre = (k: Keyframe) => k.pre ?? k.v;
  if (t < keys[0].t) return pre(keys[0]);
  if (t >= keys[n - 1].t) return keys[n - 1].v;
  let k = 0;
  while (k < n - 1 && keys[k + 1].t <= t) k++;
  const a = keys[k],
    b = keys[k + 1];
  const f = (t - a.t) / (b.t - a.t || 1);
  const ia = a.i ?? "linear",
    ib = b.i ?? "linear";
  const end = pre(b);
  if (ia === "step") return a.v;
  if (ia === "catmullrom" || ib === "catmullrom") {
    const wrap = loop && n >= 3;
    const before = keys[k - 1] ?? (wrap ? keys[n - 2] : null);
    const after = keys[k + 2] ?? (wrap ? keys[1] : null);
    const p0 = before && !a.pre ? before.v : a.v;
    const p3 = after && !b.pre ? pre(after) : end;
    return [0, 1, 2].map((c) => catmull(p0[c], a.v[c], end[c], p3[c], f)) as V3;
  }
  return [0, 1, 2].map((c) => a.v[c] + (end[c] - a.v[c]) * f) as V3;
}

function localTime(anim: VibeyAnimation, t: number) {
  if (anim.loop) return ((t % anim.length) + anim.length) % anim.length;
  return Math.min(Math.max(t, 0), anim.length);
}

interface BonePose {
  rot: V3 | null;
  pos: V3 | null;
  scale: V3 | null;
}
type Pose = Record<string, BonePose>;
interface PoseResult {
  pose: Pose;
  vis: Map<string, boolean>;
}

function evalAnim(anim: VibeyAnimation, t: number): PoseResult {
  const lt = localTime(anim, t);
  const pose: Pose = {};
  for (const [name, ch] of Object.entries(anim.bones ?? {})) {
    const lp = !!anim.loop;
    pose[name] = { rot: sampleChannel(ch.rotation, lt, lp), pos: sampleChannel(ch.position, lt, lp), scale: sampleChannel(ch.scale, lt, lp) };
  }
  const vis = new Map<string, boolean>();
  for (const e of [...(anim.events ?? [])].sort((a, b) => a.t - b.t)) if (e.type === "visibility" && e.t <= lt + 1e-9) vis.set(e.bone, e.visible);
  return { pose, vis };
}

function mergePoses(list: PoseResult[]): PoseResult {
  const pose: Pose = {};
  const vis = new Map<string, boolean>();
  for (const p of list) {
    for (const [k, v] of Object.entries(p.pose)) {
      const o = (pose[k] ??= { rot: null, pos: null, scale: null });
      if (v.rot) o.rot = o.rot ? (o.rot.map((x, i) => x + v.rot![i]) as V3) : v.rot;
      if (v.pos) o.pos = o.pos ? (o.pos.map((x, i) => x + v.pos![i]) as V3) : v.pos;
      if (v.scale) o.scale = o.scale ? (o.scale.map((x, i) => x * v.scale![i]) as V3) : v.scale;
    }
    for (const [k, v] of p.vis) vis.set(k, v);
  }
  return { pose, vis };
}

interface Node {
  M: M4;
  pivot: V3;
}

function childNode(parent: Node, pivotSpec: number[], restRot: number[] | undefined, anim: BonePose | undefined): Node {
  const piv = mcPos(pivotSpec);
  const off = anim?.pos ? mcOff(anim.pos) : [0, 0, 0];
  const rot = [0, 1, 2].map((i) => (restRot?.[i] ?? 0) + (anim?.rot?.[i] ?? 0));
  const sc = anim?.scale ?? [1, 1, 1];
  const M = mul(
    mul(mul(parent.M, T(piv[0] - parent.pivot[0] + off[0], piv[1] - parent.pivot[1] + off[1], piv[2] - parent.pivot[2] + off[2])), Rzyx(...mcRot(rot))),
    S(sc[0], sc[1], sc[2]),
  );
  return { M, pivot: piv };
}

/** Spieler-Rig (root + Körperteile) zu einer Pose. */
function computeRig(pose: Pose, slim: boolean): Map<string, Node> {
  const nodes = new Map<string, Node>();
  const root = childNode({ M: WORLD, pivot: [0, 0, 0] }, [0, 0, 0], [0, 0, 0], pose.root);
  nodes.set("root", root);
  for (const p of playerParts(slim)) nodes.set(p.name, childNode(root, p.pivot as unknown as number[], [0, 0, 0], pose[p.name]));
  return nodes;
}

interface BundleOpts {
  worldOffset?: number[];
  petScale?: number;
}

/** Knoten der Bones eines Bundles relativ zum Rig. */
function computeBones(B: Bundle, rig: Map<string, Node>, pr: PoseResult, o: BundleOpts) {
  const nodes = new Map(rig);
  const s = o.petScale ?? 1;
  nodes.set("world", { M: mul(mul(mul(mul(WORLD, T(...mcOff(o.worldOffset ?? [0, 0, 0]))), T(0, 24, 0)), S(s)), T(0, -24, 0)), pivot: [0, 0, 0] });
  const hidden = new Set<string>();
  const done = new Set<string>();
  const visit = (b: Bone | undefined) => {
    if (!b || done.has(b.name)) return;
    done.add(b.name);
    let parent: Node | undefined;
    if (b.parent) {
      visit(B.bones.get(b.parent));
      parent = nodes.get("bone:" + b.parent);
      if (hidden.has(b.parent)) hidden.add(b.name);
    } else parent = nodes.get(b.attach ?? defaultAttach(B));
    nodes.set("bone:" + b.name, childNode(parent ?? nodes.get("body")!, b.pivot ?? [0, 0, 0], b.rotation, pr.pose[b.name]));
    if (pr.vis.get(b.name) === false) hidden.add(b.name);
  };
  for (const b of B.bones.values()) visit(b);
  return { nodes, hidden };
}

/** Standard-Befestigung je Slot (Blockbench-Plugin „Auto“). */
function defaultAttach(B: Bundle) {
  if (B.json.kind === "emote") return "root";
  switch (B.json.cosmetic?.slot) {
    case "hat":
      return "head";
    case "shield":
      return "left_arm";
    case "pet":
    case "aura":
      return "world";
    default:
      return "body";
  }
}

// ------------------------------------------------------------------------------------------------ Geometrie
type FaceName = "west" | "north" | "east" | "south" | "up" | "down";
type Rect = [number, number, number, number];
// Ecken der Flächen im Modellraum (y unten): [Ecke (xMax?, yMax?, zMax?), UV-Ecke (u2?, v2?)]
const FACE_DEF: Record<FaceName, { n: V3; c: Array<[[number, number, number], [number, number]]> }> = {
  west: { n: [-1, 0, 0], c: [[[0, 0, 0], [1, 0]], [[0, 0, 1], [0, 0]], [[0, 1, 1], [0, 1]], [[0, 1, 0], [1, 1]]] },
  north: { n: [0, 0, -1], c: [[[1, 0, 0], [1, 0]], [[0, 0, 0], [0, 0]], [[0, 1, 0], [0, 1]], [[1, 1, 0], [1, 1]]] },
  east: { n: [1, 0, 0], c: [[[1, 0, 1], [1, 0]], [[1, 0, 0], [0, 0]], [[1, 1, 0], [0, 1]], [[1, 1, 1], [1, 1]]] },
  south: { n: [0, 0, 1], c: [[[0, 0, 1], [1, 0]], [[1, 0, 1], [0, 0]], [[1, 1, 1], [0, 1]], [[0, 1, 1], [1, 1]]] },
  up: { n: [0, -1, 0], c: [[[1, 0, 1], [1, 0]], [[0, 0, 1], [0, 0]], [[0, 0, 0], [0, 1]], [[1, 0, 0], [1, 1]]] },
  down: { n: [0, 1, 0], c: [[[1, 1, 1], [1, 0]], [[0, 1, 1], [0, 0]], [[0, 1, 0], [0, 1]], [[1, 1, 0], [1, 1]]] },
};
function boxRects(u: number, v: number, w: number, h: number, d: number): Record<FaceName, Rect> {
  return {
    up: [u + d, v, u + d + w, v + d],
    down: [u + d + w, v, u + d + 2 * w, v + d],
    west: [u, v + d, u + d, v + d + h],
    north: [u + d, v + d, u + d + w, v + d + h],
    east: [u + d + w, v + d, u + 2 * d + w, v + d + h],
    south: [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
  };
}
// Blockbench-Fläche → Modellraum-Fläche, mit Umrechnung der Per-Face-UV-Ausrichtung
const BB_FACE: Record<FaceName, [FaceName, (r: Rect) => Rect]> = {
  north: ["north", (r) => r],
  south: ["south", (r) => r],
  east: ["west", (r) => r],
  west: ["east", (r) => r],
  up: ["up", ([a, b, c, d]) => [c, d, a, b]],
  down: ["down", ([a, b, c, d]) => [c, b, a, d]],
};
type Faces = Partial<Record<FaceName, { rect: Rect; texture?: string | null }>>;
const rectsToFaces = (r: Record<FaceName, Rect>): Faces => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { rect: v }])) as Faces;

function cubeFaces(c: Cube, size: number[]): Faces {
  if (c.uv?.box) return rectsToFaces(boxRects(c.uv.box[0], c.uv.box[1], size[0], size[1], size[2]));
  const out: Faces = {};
  for (const [f, [mf, xf]] of Object.entries(BB_FACE) as Array<[FaceName, [FaceName, (r: Rect) => Rect]]>) {
    const fv = c.uv?.[f];
    if (!fv) continue;
    const rect = Array.isArray(fv) ? fv : fv.uv;
    if (!rect) continue;
    out[mf] = { rect: xf(rect), texture: Array.isArray(fv) ? null : fv.texture };
  }
  return out;
}
function specCube(c: { from: readonly number[]; to: readonly number[] }) {
  const a = mcPos(c.from as number[]),
    b = mcPos(c.to as number[]);
  return { min: [0, 1, 2].map((i) => Math.min(a[i], b[i])), max: [0, 1, 2].map((i) => Math.max(a[i], b[i])) };
}

interface Buf {
  pos: number[];
  uv: number[];
  nrm: number[];
}
interface CubeSpec {
  min: number[];
  max: number[];
  inflate?: number;
  mirror?: boolean;
  cubeM?: M4 | null;
}

/** Quader in Puffer schreiben (lokal zum Knoten-Pivot). */
function pushCube(out: Buf, cube: CubeSpec, pivot: number[], faces: Faces, tex: { w: number; h: number }, texScale = [1, 1]) {
  const inf = cube.inflate ?? 0;
  const mn = cube.min.map((v) => v - inf),
    mx = cube.max.map((v) => v + inf);
  const corner = (sel: number[]) => {
    let p: number[] = [sel[0] ? mx[0] : mn[0], sel[1] ? mx[1] : mn[1], sel[2] ? mx[2] : mn[2]];
    if (cube.mirror) p[0] = mn[0] + mx[0] - p[0];
    if (cube.cubeM) p = apply(cube.cubeM, p);
    return sub(p, pivot);
  };
  for (const [face, def] of Object.entries(FACE_DEF) as Array<[FaceName, (typeof FACE_DEF)[FaceName]]>) {
    const f = faces[face];
    if (!f) continue;
    let n: number[] = cube.mirror && (face === "east" || face === "west") ? [-def.n[0], 0, 0] : def.n;
    if (cube.cubeM) n = applyDir(cube.cubeM, n);
    const [u1, v1, u2, v2] = f.rect.map((x, i) => x * texScale[i % 2]);
    if (Math.abs(u2 - u1) < 1e-6 || Math.abs(v2 - v1) < 1e-6) continue;
    const pts = def.c.map(([sel, [su, sv]]) => {
      let uu = su ? u2 : u1;
      if (cube.mirror) uu = su ? u1 : u2;
      return { p: corner(sel), uv: [uu / tex.w, (sv ? v2 : v1) / tex.h] };
    });
    for (const i of [0, 1, 2, 0, 2, 3]) {
      out.pos.push(...pts[i].p);
      out.uv.push(...pts[i].uv);
      out.nrm.push(...n);
    }
  }
}

function geometry(out: Buf) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(out.uv, 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(out.nrm, 3));
  return g;
}

// ------------------------------------------------------------------------------------------------ Texturen
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    if (/^https?:/.test(src)) i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Bild nicht ladbar"));
    i.src = src;
  });

function pixelTexture(c: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Textur eines Bundles: Leinwand mit dem aktuellen Bild, animiert wie .mcmeta. */
async function bundleTexture(t: NonNullable<VibeyJson["textures"]>[number]): Promise<Tex> {
  const img = await loadImage(`data:image/png;base64,${t.png}`);
  const pxW = img.width,
    pxH = Math.round(img.width * (t.height / t.width));
  const frames = t.animation ? Math.max(1, Math.floor(img.height / pxH)) : 1;
  const c = document.createElement("canvas");
  c.width = pxW;
  c.height = pxH;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, pxW, pxH, 0, 0, pxW, pxH);
  const tex = pixelTexture(c);
  const order = t.animation?.frames ?? [...Array(frames).keys()];
  const frameTime = t.animation?.frameTime ?? 1;
  let last = "";
  const tick = (time: number) => {
    if (frames < 2 || !order.length) return;
    const f = (time * 20) / frameTime;
    const i = Math.floor(f) % order.length;
    const k = t.animation?.interpolate ? f - Math.floor(f) : 0;
    const key = `${i}:${Math.round(k * 16)}`;
    if (key === last) return;
    last = key;
    g.globalAlpha = 1;
    g.clearRect(0, 0, pxW, pxH);
    g.drawImage(img, 0, order[i] * pxH, pxW, pxH, 0, 0, pxW, pxH);
    if (k > 0.02) {
      g.globalAlpha = k;
      g.drawImage(img, 0, order[(i + 1) % order.length] * pxH, pxW, pxH, 0, 0, pxW, pxH);
    }
    tex.needsUpdate = true;
  };
  return { id: t.id, w: t.width, h: t.height, img, pxW, pxH, tex, tick };
}

/** `.vibey`-JSON in ein renderbares Bundle umwandeln (Texturen dekodieren). */
export async function prepareBundle(json: VibeyJson): Promise<Bundle> {
  const tex = new Map<string, Tex>();
  for (const t of json.textures ?? []) tex.set(t.id, await bundleTexture(t));
  return {
    json,
    tex,
    bones: new Map((json.model?.bones ?? []).map((b) => [b.name, b])),
    sprites: new Map((json.sprites ?? []).map((s) => [s.id, s])),
    locators: json.model?.locators ?? {},
  };
}

// ------------------------------------------------------------------------------------------------ Skin

/** Neutraler Ersatz-Skin (Kapuzenpulli), wenn kein Skin geladen werden kann. */
function fallbackSkinCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const box = (u: number, v: number, w: number, h: number, d: number, col: string, top = col) => {
    const r = boxRects(u, v, w, h, d);
    for (const [k, [x1, y1, x2, y2]] of Object.entries(r)) {
      g.fillStyle = k === "up" ? top : col;
      g.fillRect(x1, y1, x2 - x1, y2 - y1);
    }
  };
  box(0, 0, 8, 8, 8, "#d9a27e", "#3b3f4c"); // Kopf
  g.fillStyle = "#3b3f4c";
  g.fillRect(8, 8, 8, 2); // Haare vorne
  g.fillRect(0, 8, 8, 3);
  g.fillRect(16, 8, 8, 3);
  g.fillRect(24, 8, 8, 8);
  g.fillStyle = "#2c3140";
  g.fillRect(10, 12, 1, 1);
  g.fillRect(13, 12, 1, 1);
  box(16, 16, 8, 12, 4, "#566074"); // Körper
  box(40, 16, 4, 12, 4, "#566074"); // rechter Arm
  box(32, 48, 4, 12, 4, "#566074"); // linker Arm
  box(0, 16, 4, 12, 4, "#2f3442"); // Beine
  box(16, 48, 4, 12, 4, "#2f3442");
  g.fillStyle = "#d9a27e"; // Hände
  for (const [u, v] of [
    [40, 16],
    [32, 48],
  ]) {
    g.fillRect(u + 4, v + 4 + 10, 4, 2);
    g.fillRect(u + 12, v + 4 + 10, 4, 2);
  }
  return c;
}

/** Skin laden (data:/https-URL) und auf das 64×64-Layout bringen (alte 64×32-Skins: linke Gliedmaßen gespiegelt). */
async function skinCanvas(src: string | null): Promise<HTMLCanvasElement> {
  if (!src) return fallbackSkinCanvas();
  try {
    const img = await loadImage(src);
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const s = img.width / 64;
    if (Math.abs(img.height * 2 - img.width) < 1) {
      g.drawImage(img, 0, 0, img.width, img.height, 0, 0, 64, 32);
      // Altes Layout: linker Arm/linkes Bein = gespiegelte rechte Teile
      const mirror = (sx: number, sy: number, dx: number, dy: number) => {
        g.save();
        g.translate(dx + 16, dy);
        g.scale(-1, 1);
        g.drawImage(c, sx, sy, 16, 16, 0, 0, 16, 16);
        g.restore();
      };
      mirror(40, 16, 32, 48);
      mirror(0, 16, 16, 48);
    } else {
      g.drawImage(img, 0, 0, 64 * s, 64 * s, 0, 0, 64, 64);
    }
    return c;
  } catch {
    return fallbackSkinCanvas();
  }
}

// ------------------------------------------------------------------------------------------------ Partikel
const VANILLA_PARTICLES: Record<string, { life: number; color: string | null; glyph: string; size: number; emissive?: boolean; gravity?: number }> = {
  "minecraft:note": { life: 0.6, color: null, glyph: "note", size: 0.25, emissive: true },
  "minecraft:snowflake": { life: 1.2, color: "#ffffff", glyph: "flake", size: 0.1, gravity: 0.0025 },
  "minecraft:heart": { life: 0.8, color: "#ff4d6d", glyph: "heart", size: 0.25 },
  "minecraft:end_rod": { life: 1.5, color: "#fffbe8", glyph: "dot", size: 0.12, emissive: true },
  "minecraft:happy_villager": { life: 0.8, color: "#5dd36b", glyph: "dot", size: 0.12 },
  "minecraft:firework": { life: 1.0, color: "#ffffff", glyph: "dot", size: 0.12, emissive: true },
  "minecraft:cloud": { life: 1.0, color: "#f0f0f0", glyph: "puff", size: 0.3 },
  "minecraft:poof": { life: 0.5, color: "#f0f0f0", glyph: "puff", size: 0.25 },
  "minecraft:bubble_pop": { life: 0.4, color: "#bfe8ff", glyph: "ring", size: 0.15 },
  "minecraft:splash": { life: 0.6, color: "#6fb7ff", glyph: "dot", size: 0.1, gravity: 0.04 },
  "minecraft:flame": { life: 0.8, color: "#ffb547", glyph: "dot", size: 0.12, emissive: true },
  "minecraft:crit": { life: 0.6, color: "#ffffff", glyph: "dot", size: 0.1 },
};
const NOTE_COLORS = ["#5dd36b", "#3fe0c5", "#8b6cff", "#ff6fae", "#ffd25a"];
const GLYPHS: Record<string, string[]> = {
  note: ["..##", "..#.", "..#.", "###.", "##.."],
  flake: ["#.#.#", ".###.", "##.##", ".###.", "#.#.#"],
  heart: [".#.#.", "#####", "#####", ".###.", "..#.."],
  dot: ["##", "##"],
  puff: [".##.", "####", "####", ".##."],
  ring: [".##.", "#..#", "#..#", ".##."],
};
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const normParticle = (p: string) => (p.includes(":") ? p : `minecraft:${p}`);

interface Particle {
  p: V3;
  size: number;
  sprite: string | null;
  glyph?: string;
  color: string;
  emissive: boolean;
  alpha: number;
}

/** Deterministische Partikel einer laufenden Animation. `locAt(locator, te)` liefert die Weltposition. */
function simulateParticles(B: Bundle, anims: Array<{ name: string; t: number }>, locAt: (loc: string | undefined, te: number, anim: string) => V3): Particle[] {
  const out: Particle[] = [];
  for (const a of anims) {
    const anim = B.json.animations?.[a.name];
    if (!anim?.events?.length) continue;
    const loops = anim.loop ? Math.ceil(3 / Math.max(anim.length, 0.05)) + 1 : 0;
    anim.events.forEach((ev, ei) => {
      if (ev.type !== "particle") return;
      const vp = ev.particle ? (VANILLA_PARTICLES[normParticle(ev.particle)] ?? { life: 1, color: "#ffffff", glyph: "dot", size: 0.12 }) : null;
      const life = ev.lifetime ?? vp?.life ?? 1;
      for (let k = 0; k <= loops; k++) {
        const te = ev.t + (anim.loop ? Math.floor(a.t / anim.length) * anim.length - k * anim.length : 0);
        const age = a.t - te;
        if (age < 0 || age > life) continue;
        if (!anim.loop && te > anim.length) continue;
        const origin = locAt(ev.locator, te, a.name);
        const r = rng(1000 + ei * 7919 + Math.round(te * 1000));
        const n = Math.min(64, Math.round(ev.count ?? 1));
        const sp = typeof ev.spread === "number" ? [ev.spread, ev.spread, ev.spread] : (ev.spread ?? [0, 0, 0]);
        const vel = typeof ev.velocity === "number" ? [0, ev.velocity, 0] : (ev.velocity ?? [0, 0, 0]);
        for (let i = 0; i < n; i++) {
          const off = [(r() * 2 - 1) * sp[0], (r() * 2 - 1) * sp[1], (r() * 2 - 1) * sp[2]];
          const v = vel.map((x: number, c: number) => (c === 0 ? -x : x) * (1 + (r() * 2 - 1) * 0.3));
          const drift = [(r() * 2 - 1) * Math.abs(vel[1]) * 0.35, 0, (r() * 2 - 1) * Math.abs(vel[1]) * 0.35];
          const g = ev.gravity ?? vp?.gravity ?? 0;
          const ticks = age * 20;
          const lifeFrac = age / life;
          let color = vp?.color ?? "#ffffff";
          if (vp?.glyph === "note") color = NOTE_COLORS[(ei + i) % NOTE_COLORS.length];
          out.push({
            p: [
              origin[0] + (off[0] + (v[0] + drift[0]) * ticks) * 16,
              origin[1] + (off[1] + v[1] * ticks - 0.5 * g * ticks * ticks) * 16,
              origin[2] - (off[2] + (v[2] + drift[2]) * ticks) * 16,
            ],
            size: (ev.size ?? vp?.size ?? 0.15) * 16 * (lifeFrac > 0.7 ? 1 - ((lifeFrac - 0.7) / 0.3) * 0.6 : 1),
            sprite: ev.sprite ?? null,
            glyph: vp?.glyph,
            color,
            emissive: ev.emissive ?? vp?.emissive ?? false,
            alpha: lifeFrac > 0.75 ? 1 - (lifeFrac - 0.75) / 0.25 : 1,
          });
        }
      }
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ Szene

const toMatrix = (m: M4, target: THREE.Matrix4) => target.set(...(m as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]));

type NodeRef = string | ((nodes: Map<string, Node>) => M4);
interface Drawable {
  mesh: THREE.Mesh;
  nodeRef: NodeRef;
  bone: string | null;
}

class MaterialCache {
  private m = new Map<string, THREE.Material>();
  get(map: THREE.Texture, key: string, flags: { emissive?: boolean; translucent?: boolean } = {}) {
    const k = `${key}|${flags.emissive ? 1 : 0}|${flags.translucent ? 1 : 0}`;
    let mat = this.m.get(k);
    if (!mat) {
      const common = { map, side: THREE.DoubleSide, transparent: !!flags.translucent, alphaTest: flags.translucent ? 0.02 : 0.5, depthWrite: !flags.translucent };
      mat = flags.emissive ? new THREE.MeshBasicMaterial({ ...common, toneMapped: false }) : new THREE.MeshLambertMaterial(common);
      this.m.set(k, mat);
    }
    return mat;
  }
  dispose() {
    for (const m of this.m.values()) m.dispose();
    this.m.clear();
  }
}

/** Gezeichnete Teile eines Bundles (Bones, Textur-Cape, Textur-Schild) + Partikel-Pool. */
class BundleView {
  group = new THREE.Group();
  drawables: Drawable[] = [];
  private mats = new MaterialCache();
  private pool: THREE.Sprite[] = [];
  private spriteTex = new Map<string, THREE.Texture>();
  readonly opts: BundleOpts;

  constructor(
    readonly B: Bundle,
    opts: BundleOpts & { standalone?: boolean },
  ) {
    this.opts = opts;
    const slot = B.json.cosmetic?.slot;
    const addMesh = (out: Buf, mat: THREE.Material, nodeRef: NodeRef, bone: string | null = null) => {
      if (!out.pos.length) return;
      const mesh = new THREE.Mesh(geometry(out), mat);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.drawables.push({ mesh, nodeRef, bone });
    };
    // Cape aus Textur: Vanilla-Cape am Rücken
    const capeTex = slot === "cape" && B.json.cosmetic?.cape?.texture ? B.tex.get(B.json.cosmetic.cape.texture) : undefined;
    if (capeTex) {
      const sc = capeTex.w / 64;
      const out: Buf = { pos: [], uv: [], nrm: [] };
      pushCube(out, { min: [-5, 0, -1], max: [5, 16, 0] }, [0, 0, 0], rectsToFaces(boxRects(0, 0, 10, 16, 1)), capeTex, [sc, sc]);
      addMesh(out, this.mats.get(capeTex.tex, capeTex.id), (nodes) => mul(mul(mul(nodes.get("body")!.M, T(0, 0, 2)), Rx(deg(6))), Ry(Math.PI)));
    }
    // Schild aus Textur: Vanilla-Schild in der Offhand (linke Hand)
    const shieldTex = slot === "shield" && B.json.cosmetic?.shield?.texture ? B.tex.get(B.json.cosmetic.shield.texture) : undefined;
    if (shieldTex) {
      const sc = shieldTex.w / 64;
      const HAND = mul(mul(mul(mul(mul(mul(Rx(deg(-90)), Ry(Math.PI)), T(-1, 2, -10)), T(-10, 6, 12)), Ry(deg(-90))), T(-8, -8, -8)), S(1, -1, -1));
      const M: NodeRef = opts.standalone ? () => mul(WORLD, T(0, 8, 0)) : (nodes) => mul(nodes.get("left_arm")!.M, HAND);
      const parts: Array<[number[], number[], Record<FaceName, Rect>]> = [
        [[-6, -11, -2], [6, 11, -1], boxRects(0, 0, 12, 22, 1)],
        [[-1, -3, -1], [1, 3, 5], boxRects(26, 0, 2, 6, 6)],
      ];
      for (const [mn, mx, rects] of parts) {
        const out: Buf = { pos: [], uv: [], nrm: [] };
        pushCube(out, { min: mn, max: mx }, [0, 0, 0], rectsToFaces(rects), shieldTex, [sc, sc]);
        addMesh(out, this.mats.get(shieldTex.tex, shieldTex.id), M);
      }
    }
    // Bones des Modells
    const defTex = B.json.model?.texture ?? B.json.textures?.[0]?.id;
    for (const b of B.bones.values()) {
      const pivot = mcPos(b.pivot ?? [0, 0, 0]);
      const perTex = new Map<string, Buf>();
      for (const c of b.cubes ?? []) {
        const m = specCube(c);
        const size = [0, 1, 2].map((i) => Math.abs(c.to[i] - c.from[i]));
        let cubeM: M4 | null = null;
        if (c.rotation && c.rotation.some((v) => v)) {
          const cp = mcPos(c.pivot ?? [0, 0, 0]);
          cubeM = mul(mul(T(...cp), Rzyx(...mcRot(c.rotation))), T(-cp[0], -cp[1], -cp[2]));
        }
        const faces = cubeFaces(c, size);
        // Flächen nach Textur gruppieren (Fläche → Quader → Modell → erste Textur)
        const byTex = new Map<string, Faces>();
        for (const [f, val] of Object.entries(faces) as Array<[FaceName, { rect: Rect; texture?: string | null }]>) {
          const id = val.texture ?? c.texture ?? defTex;
          if (!id) continue;
          if (!byTex.has(id)) byTex.set(id, {});
          byTex.get(id)![f] = val;
        }
        for (const [id, fs] of byTex) {
          const t = B.tex.get(id);
          if (!t) continue;
          if (!perTex.has(id)) perTex.set(id, { pos: [], uv: [], nrm: [] });
          pushCube(perTex.get(id)!, { ...m, inflate: c.inflate, mirror: c.mirror, cubeM }, pivot, fs, t);
        }
      }
      for (const [id, out] of perTex) {
        const t = B.tex.get(id)!;
        addMesh(out, this.mats.get(t.tex, t.id, { emissive: !!b.emissive, translucent: !!b.translucent }), "bone:" + b.name, b.name);
      }
    }
  }

  private particleTexture(pa: Particle) {
    const key = pa.sprite ? `s:${pa.sprite}` : `g:${pa.glyph}:${pa.color}`;
    const hit = this.spriteTex.get(key);
    if (hit) return hit;
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    if (pa.sprite) {
      const s = this.B.sprites.get(pa.sprite);
      const t = s && this.B.tex.get(s.texture);
      const [u1, v1, u2, v2] = s?.uv ?? [0, 0, 1, 1];
      const k = t ? t.pxW / t.w : 1;
      c.width = Math.max(1, Math.round((u2 - u1) * k));
      c.height = Math.max(1, Math.round((v2 - v1) * k));
      if (t) {
        g.imageSmoothingEnabled = false;
        g.drawImage(t.img, u1 * k, v1 * k, c.width, c.height, 0, 0, c.width, c.height);
      }
    } else {
      const gl = GLYPHS[pa.glyph ?? "dot"] ?? GLYPHS.dot;
      c.width = gl[0].length;
      c.height = gl.length;
      g.fillStyle = pa.color;
      gl.forEach((row, y) => [...row].forEach((ch, x) => ch === "#" && g.fillRect(x, y, 1, 1)));
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    this.spriteTex.set(key, tex);
    return tex;
  }

  /** Matrizen für dieses Bild setzen. */
  update(time: number, rig: Map<string, Node>, pr: PoseResult, anims: Array<{ name: string; t: number }>, locAt: (loc: string | undefined, te: number, anim: string) => V3, particles: boolean) {
    const { nodes, hidden } = computeBones(this.B, rig, pr, this.opts);
    for (const d of this.drawables) {
      const n = typeof d.nodeRef === "function" ? d.nodeRef(nodes) : nodes.get(d.nodeRef)?.M;
      if (!n) continue;
      toMatrix(n, d.mesh.matrix);
      d.mesh.visible = !(d.bone && hidden.has(d.bone));
      d.mesh.matrixWorldNeedsUpdate = true;
    }
    for (const t of this.B.tex.values()) t.tick(time);
    const parts = particles ? simulateParticles(this.B, anims, locAt) : [];
    parts.forEach((pa, i) => {
      let s = this.pool[i];
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
        this.group.add(s);
        this.pool[i] = s;
      }
      s.visible = true;
      s.position.set(pa.p[0], pa.p[1], pa.p[2]);
      s.scale.setScalar(Math.max(0.5, pa.size));
      const tex = this.particleTexture(pa);
      if (s.material.map !== tex) {
        s.material.map = tex;
        s.material.needsUpdate = true;
      }
      s.material.opacity = pa.alpha;
      s.material.blending = pa.emissive ? THREE.AdditiveBlending : THREE.NormalBlending;
    });
    for (let i = parts.length; i < this.pool.length; i++) this.pool[i].visible = false;
    return nodes;
  }

  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.mats.dispose();
    for (const t of this.spriteTex.values()) t.dispose();
    for (const s of this.pool) s.material.dispose();
  }
}

/** Spieler mit Skin (Grund- + Overlay-Schicht). */
class PlayerView {
  group = new THREE.Group();
  drawables: Drawable[] = [];
  private mats = new MaterialCache();
  constructor(
    readonly tex: THREE.Texture,
    readonly slim: boolean,
  ) {
    const skin = { w: 64, h: 64 };
    for (const p of playerParts(slim)) {
      const m = specCube(p);
      const size = [0, 1, 2].map((i) => m.max[i] - m.min[i]);
      const pivot = mcPos(p.pivot as unknown as number[]);
      for (const layer of [0, 1] as const) {
        const out: Buf = { pos: [], uv: [], nrm: [] };
        const uv = layer ? p.ov : p.uv;
        pushCube(out, { ...m, inflate: layer ? p.inf : 0 }, pivot, rectsToFaces(boxRects(uv[0], uv[1], size[0], size[1], size[2])), skin);
        const mesh = new THREE.Mesh(geometry(out), this.mats.get(tex, layer ? "skin-ov" : "skin"));
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.drawables.push({ mesh, nodeRef: p.name, bone: null });
      }
    }
  }
  update(rig: Map<string, Node>) {
    for (const d of this.drawables) {
      toMatrix(rig.get(d.nodeRef as string)!.M, d.mesh.matrix);
      d.mesh.matrixWorldNeedsUpdate = true;
    }
  }
  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.mats.dispose();
  }
}

// ------------------------------------------------------------------------------------------------ Szene: Spieler + Loadout + Emote

export type Mode = "idle" | "walk" | "fly";

/** Pet neben dem Spieler, Aura am Spieler (wie der Client: Begleiter folgen seitlich). */
function bundleOpts(json: VibeyJson): BundleOpts {
  const slot = json.cosmetic?.slot;
  return { worldOffset: slot === "pet" ? [20, 0, 6] : [0, 0, 0], petScale: slot === "pet" ? (json.cosmetic?.pet?.scale ?? 1) : 1 };
}

/** Szene ohne Renderer: Spieler + beliebig viele Bundles. Wird vom Viewer und vom Vorschaubild-Renderer benutzt. */
class LoadoutScene {
  root = new THREE.Group();
  private player: PlayerView | null = null;
  private skinTex: THREE.Texture | null = null;
  private items: BundleView[] = [];
  private emote: { view: BundleView; t0: number } | null = null;
  slim = false;
  showPlayer = true;

  constructor() {
    this.root.scale.setScalar(1 / 16);
  }

  setSkin(canvas: HTMLCanvasElement, slim: boolean) {
    this.skinTex?.dispose();
    this.skinTex = pixelTexture(canvas);
    this.slim = slim;
    this.rebuildPlayer();
  }

  private rebuildPlayer() {
    if (this.player) {
      this.root.remove(this.player.group);
      this.player.dispose();
      this.player = null;
    }
    if (this.skinTex && this.showPlayer) {
      this.player = new PlayerView(this.skinTex, this.slim);
      this.root.add(this.player.group);
    }
  }

  setShowPlayer(v: boolean) {
    if (this.showPlayer === v) return;
    this.showPlayer = v;
    this.rebuildPlayer();
  }

  setItems(bundles: Bundle[], standalone = false) {
    // Unveränderte Bundles behalten (keine Neuaufbauten beim Anprobieren)
    const keep = new Map(this.items.map((v) => [v.B, v]));
    const next: BundleView[] = [];
    for (const b of bundles) {
      const v = keep.get(b) ?? new BundleView(b, { ...bundleOpts(b.json), standalone });
      keep.delete(b);
      next.push(v);
      if (!v.group.parent) this.root.add(v.group);
    }
    for (const v of keep.values()) {
      this.root.remove(v.group);
      v.dispose();
    }
    this.items = next;
  }

  setEmote(b: Bundle | null, now: number) {
    if (this.emote && this.emote.view.B === b) {
      this.emote.t0 = now;
      return;
    }
    if (this.emote) {
      this.root.remove(this.emote.view.group);
      this.emote.view.dispose();
      this.emote = null;
    }
    if (b) {
      const view = new BundleView(b, {});
      this.root.add(view.group);
      this.emote = { view, t0: now };
    }
  }

  hasEmote() {
    return !!this.emote;
  }

  /** Alles für Zeitpunkt `nowMs` stellen. */
  update(nowMs: number, t: number, mode: Mode, particles = true) {
    // Emote: Schleife (einmal abspielen, kurz stehen, wieder von vorn)
    let emotePr: PoseResult | null = null;
    let emoteAnim: { name: string; t: number } | null = null;
    let emoteDef: VibeyAnimation | undefined;
    if (this.emote) {
      const json = this.emote.view.B.json;
      const name = json.emote?.animation ?? "main";
      emoteDef = json.animations?.[name];
      if (emoteDef) {
        const et = (nowMs - this.emote.t0) / 1000;
        const len = emoteDef.loop ? emoteDef.length : emoteDef.length + 0.8;
        emoteAnim = { name, t: emoteDef.loop ? et : Math.min(et % Math.max(len, 0.05), emoteDef.length) };
        emotePr = evalAnim(emoteDef, emoteAnim.t);
      }
    }
    const base: PoseResult = { pose: {}, vis: new Map() };
    const hasShield = this.items.some((v) => v.B.json.cosmetic?.slot === "shield");
    if (!emotePr) {
      if (hasShield) base.pose.left_arm = { rot: [18, 0, 0], pos: null, scale: null };
      if (mode === "walk") {
        const s = Math.sin(t * Math.PI * 2 * 0.9) * 32;
        base.pose.right_leg = { rot: [s, 0, 0], pos: null, scale: null };
        base.pose.left_leg = { rot: [-s, 0, 0], pos: null, scale: null };
        base.pose.right_arm = { rot: [-s * 0.8, 0, 0], pos: null, scale: null };
        base.pose.left_arm = { rot: [s * 0.8 + (hasShield ? 18 : 0), 0, 0], pos: null, scale: null };
      } else if (mode === "idle") {
        // leichtes Atmen wie im Spiel
        const b = Math.sin(t * 1.4) * 2.5;
        base.pose.right_arm = { rot: [0, 0, -b - 2], pos: null, scale: null };
        base.pose.left_arm = { rot: [hasShield ? 18 : 0, 0, b + 2], pos: null, scale: null };
      }
    }
    const rigPose = (pr: PoseResult | null) => {
      if (!pr) return base.pose;
      const only: Pose = {};
      for (const n of ["root", ...PLAYER_NAMES]) if (pr.pose[n]) only[n] = pr.pose[n];
      return mergePoses([base, { pose: only, vis: new Map() }]).pose;
    };
    const rig = computeRig(rigPose(emotePr), this.slim);
    this.player?.update(rig);
    const rigAtEmote = (te: number) => (emoteDef ? computeRig(rigPose(evalAnim(emoteDef, te)), this.slim) : rig);
    for (const v of this.items) {
      const anims = this.animsFor(v.B.json, t, mode);
      const pr = mergePoses(anims.map((a) => evalAnim(v.B.json.animations![a.name], a.t)));
      v.update(t, rig, pr, anims, (loc, te, an) => this.locator(v, rig, loc, te, an), particles);
    }
    if (this.emote && emotePr && emoteAnim) {
      const v = this.emote.view;
      v.update(t, rig, emotePr, [emoteAnim], (loc, te) => {
        const r = rigAtEmote(te);
        return this.locator(v, r, loc, te, emoteAnim!.name, evalAnim(emoteDef!, te));
      }, particles);
    }
  }

  private animsFor(json: VibeyJson, t: number, mode: Mode) {
    const list: Array<{ name: string; t: number }> = [];
    if (json.animations?.idle) list.push({ name: "idle", t });
    if (mode !== "idle" && json.animations?.[mode]) list.push({ name: mode, t });
    return list;
  }

  private locator(v: BundleView, rig: Map<string, Node>, locName: string | undefined, te: number, animName: string, emotePr?: PoseResult): V3 {
    const loc = locName ? v.B.locators[locName] : undefined;
    if (!loc) return apply(rig.get("body")!.M, [0, -6, 0]);
    let pr: PoseResult;
    if (emotePr) pr = emotePr;
    else {
      const anims = (v.B.json.animations?.idle ? [{ name: "idle", t: te }] : []).concat(animName !== "idle" ? [{ name: animName, t: te }] : []);
      pr = mergePoses(anims.filter((a) => v.B.json.animations?.[a.name]).map((a) => evalAnim(v.B.json.animations![a.name], a.t)));
    }
    const { nodes } = computeBones(v.B, rig, pr, v.opts);
    const node = PLAYER_NAMES.includes(loc.bone) || loc.bone === "root" ? nodes.get(loc.bone) : nodes.get("bone:" + loc.bone);
    if (!node) return [0, 12, 0];
    return apply(node.M, sub(mcPos(loc.position ?? [0, 0, 0]), node.pivot));
  }

  dispose() {
    this.player?.dispose();
    this.skinTex?.dispose();
    for (const v of this.items) v.dispose();
    this.emote?.view.dispose();
  }
}

// ------------------------------------------------------------------------------------------------ Viewer

export type ViewSide = "front" | "back" | "side";
const YAW: Record<ViewSide, number> = { front: 30, back: 205, side: 270 };

export interface WardrobeViewer {
  setSkin(src: string | null, slim: boolean): Promise<void>;
  setItems(bundles: Bundle[]): void;
  playEmote(b: Bundle | null): void;
  setMode(m: Mode): void;
  view(side: ViewSide, animate?: boolean): void;
  reset(): void;
  setAutoRotate(on: boolean): void;
  /** Aktuelles Bild als PNG (quadratisch zugeschnitten, `size`×`size`) */
  snapshot(size?: number): string;
  dispose(): void;
}

/** Großer, drehbarer Viewer: Spieler mit Skin, Loadout und Emote. Ziehen dreht, Mausrad zoomt. */
export function createWardrobeViewer(canvas: HTMLCanvasElement, opts: { reduceMotion?: boolean } = {}): WardrobeViewer {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a46, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  scene.add(key);
  // Bodenschatten + Ring in Markenfarbe
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.62, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.69, 64), new THREE.MeshBasicMaterial({ color: 0x8b6cff, transparent: true, opacity: 0.55, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.003;
  scene.add(ring);
  const ls = new LoadoutScene();
  scene.add(ls.root);

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 2;
  controls.maxDistance = 9;
  controls.rotateSpeed = 0.8;
  controls.target.set(0, 1.12, 0);

  let mode: Mode = "idle";
  let w = 1,
    h = 1;
  const t0 = performance.now();
  let tween: { from: number; to: number; dist: number; start: number } | null = null;
  let dist = 4.8;

  const yawNow = () => Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  const place = (yawRad: number, d = dist, pitchDeg = 10) => {
    const p = deg(pitchDeg);
    camera.position.set(controls.target.x + Math.sin(yawRad) * Math.cos(p) * d, controls.target.y + Math.sin(p) * d, controls.target.z + Math.cos(yawRad) * Math.cos(p) * d);
    camera.lookAt(controls.target);
    controls.update();
  };
  const fitDistance = () => {
    const tanF = Math.tan(deg(camera.fov / 2));
    const aspect = Math.max(0.4, w / Math.max(1, h));
    // Spieler (2 Blöcke hoch) + Flügel/Begleiter (breiter): grob 2.6 × 2.2
    // Spieler mit Hut (≈2,4 Blöcke) + Flügel/Begleiter (≈2,8 breit), etwas Luft für die Knöpfe oben
    return Math.min(9, Math.max(3.6, Math.max(2.5 / 2 / tanF, 2.8 / 2 / (tanF * aspect)) * 1.3));
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  dist = fitDistance();
  place(deg(YAW.front));
  const ro = new ResizeObserver(() => {
    resize();
  });
  ro.observe(canvas);

  let raf = 0;
  let visible = true;
  const io = new IntersectionObserver((e) => {
    visible = e.some((x) => x.isIntersecting);
  });
  io.observe(canvas);
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    if (tween) {
      const k = Math.min(1, (now - tween.start) / 450);
      const e = 1 - Math.pow(1 - k, 3);
      let d = tween.to - tween.from;
      d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      place(tween.from + d * e, tween.dist);
      if (k >= 1) tween = null;
    }
    controls.update();
    key.position.copy(camera.position).add(new THREE.Vector3(-2, 4, 0));
    const t = opts.reduceMotion ? 0.3 : (now - t0) / 1000;
    ls.update(now, t, mode, !opts.reduceMotion);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    async setSkin(src, slim) {
      ls.setSkin(await skinCanvas(src), slim);
    },
    setItems(bundles) {
      ls.setItems(bundles);
    },
    playEmote(b) {
      ls.setEmote(b, performance.now());
    },
    setMode(m) {
      mode = m;
    },
    view(side, animate = true) {
      const to = deg(YAW[side]);
      const d = camera.position.distanceTo(controls.target);
      if (!animate || opts.reduceMotion) place(to, d);
      else tween = { from: yawNow(), to, dist: d, start: performance.now() };
    },
    reset() {
      dist = fitDistance();
      tween = { from: yawNow(), to: deg(YAW.front), dist, start: performance.now() };
    },
    setAutoRotate(on) {
      controls.autoRotate = on;
      controls.autoRotateSpeed = 1.2;
    },
    snapshot(size = 256) {
      renderer.render(scene, camera);
      const src = renderer.domElement;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d")!;
      const s = Math.min(src.width, src.height);
      g.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
      return c.toDataURL("image/png");
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      ls.dispose();
      floor.geometry.dispose();
      ring.geometry.dispose();
      renderer.dispose();
    },
  };
}

// ------------------------------------------------------------------------------------------------ Vorschaubilder (offscreen)

let thumbRenderer: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; key: THREE.DirectionalLight } | null = null;
let thumbQueue: Promise<unknown> = Promise.resolve();
let thumbSkin: HTMLCanvasElement | null = null;

/**
 * Vorschaubild (PNG data:-URL) eines Bundles wie auf der Website: Cosmetics ohne Spieler, Emotes am Spieler
 * mitten in der Animation. Ein gemeinsamer Offscreen-Renderer, Aufträge laufen nacheinander.
 */
export function renderThumbnail(b: Bundle, size = 256): Promise<string> {
  const job = thumbQueue.then(async () => {
    if (!thumbRenderer) {
      const canvas = document.createElement("canvas");
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a46, 1.8));
      const key = new THREE.DirectionalLight(0xffffff, 1.3);
      scene.add(key);
      thumbRenderer = { renderer, scene, camera: new THREE.PerspectiveCamera(30, 1, 0.05, 100), key };
    }
    thumbSkin ??= fallbackSkinCanvas();
    const { renderer, scene, camera, key } = thumbRenderer;
    renderer.setSize(size, size, false);
    const emote = b.json.kind === "emote";
    const slot = b.json.cosmetic?.slot;
    const ls = new LoadoutScene();
    ls.showPlayer = emote;
    ls.setSkin(thumbSkin, false);
    if (emote) ls.setEmote(b, 0);
    else ls.setItems([b], true);
    scene.add(ls.root);
    const len = emote ? (b.json.animations?.[b.json.emote?.animation ?? "main"]?.length ?? 1) : 1;
    ls.update(emote ? len * 0.45 * 1000 : 300, emote ? len * 0.45 : 0.3, "idle", false);
    ls.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ls.root, true);
    const center = box.isEmpty() ? new THREE.Vector3(0, 1, 0) : box.getCenter(new THREE.Vector3());
    const sz = box.isEmpty() ? new THREE.Vector3(1, 2, 1) : box.getSize(new THREE.Vector3());
    const back = ["cape", "wings", "back"].includes(slot ?? "");
    const yaw = deg(back ? 205 : slot === "pet" ? 40 : 30);
    const r = Math.max(sz.x, sz.y, sz.z) * 0.62;
    const d = r / Math.sin(deg(camera.fov / 2)) * 1.02;
    camera.position.set(center.x + Math.sin(yaw) * Math.cos(deg(12)) * d, center.y + Math.sin(deg(12)) * d, center.z + Math.cos(yaw) * Math.cos(deg(12)) * d);
    camera.lookAt(center);
    key.position.copy(camera.position).add(new THREE.Vector3(-2, 4, 0));
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");
    scene.remove(ls.root);
    ls.dispose();
    return url;
  });
  thumbQueue = job.catch(() => {});
  return job;
}
