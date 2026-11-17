// Vibe-Craft-Studios-Logo: Robbe im Minecraft-Stil – aus Quadern gebaut, mit Pixel-Texturen (1 Texel = 1 Einheit),
// in den Markenfarben (Lila-Robbe auf türkisem Eis). Wird vom 3D-Logo in der App genutzt und zum Rendern der Icons.
// Animierbare Teile: Kopf, vordere/hintere Flossen, Blinzeln.
import type * as THREE_NS from "three";

export const SEAL_COLORS = {
  body: "#9a84ff",
  back: "#8a72fb",
  belly: "#d9d0ff",
  spot: "#7457ec",
  snout: "#f3f0ff",
  flipper: "#7a5ff0",
  eye: "#17121f",
  shine: "#ffffff",
  lid: "#7a62ee",
  nose: "#2a2138",
  whisker: "#b7a9f5",
  cheek: "#ff9db8",
  ice: "#3fe0c5",
  iceLight: "#8ff5e3",
  iceSide: "#2fb8a3",
  iceDark: "#1f9e8a",
};
export type SealPalette = typeof SEAL_COLORS;

/** Alternative Farbschemata (zum Ausprobieren). */
export const SEAL_PALETTES: Record<string, SealPalette> = {
  marke: SEAL_COLORS,
  natur: {
    body: "#8f9aa6", back: "#7d8894", belly: "#cdd4db", spot: "#68737f", snout: "#e8ecf0", flipper: "#707b87",
    eye: "#141418", shine: "#ffffff", lid: "#7d8894", nose: "#2a2a30", whisker: "#a3acb5", cheek: "#ff9db8",
    ice: "#e3f0f9", iceLight: "#f6fbff", iceSide: "#bcd9ee", iceDark: "#9cc4e2",
  },
  dezent: {
    body: "#9a9cb3", back: "#888aa3", belly: "#d6d6e6", spot: "#727493", snout: "#eeeef6", flipper: "#7b7d99",
    eye: "#141418", shine: "#ffffff", lid: "#888aa3", nose: "#2a2a34", whisker: "#aeb0c6", cheek: "#ff9db8",
    ice: "#e6f2f6", iceLight: "#f7fbfd", iceSide: "#b7dbe3", iceDark: "#93c4cf",
  },
  dunkel: {
    body: "#5d6573", back: "#4f5765", belly: "#a9b0bb", spot: "#424956", snout: "#d9dde3", flipper: "#4a515e",
    eye: "#0e0e12", shine: "#ffffff", lid: "#4f5765", nose: "#1c1c22", whisker: "#7c8491", cheek: "#ff9db8",
    ice: "#e3f0f9", iceLight: "#f6fbff", iceSide: "#bcd9ee", iceDark: "#9cc4e2",
  },
};
let C: SealPalette = SEAL_COLORS;

type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function hex(c: string) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Grundfarbe mit ganz leichtem Pixelrauschen. */
function noisy(base: string, amount = 0.018, seed = 1): Painter {
  return (g, w, h) => {
    const r = rng(seed);
    const [R, G, B] = hex(base);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const f = 1 + (r() - 0.5) * 2 * amount;
        g.fillStyle = `rgb(${Math.min(255, R * f) | 0},${Math.min(255, G * f) | 0},${Math.min(255, B * f) | 0})`;
        g.fillRect(x, y, 1, 1);
      }
  };
}

function px(color: string, list: [number, number][]): Painter {
  return (g) => {
    g.fillStyle = color;
    for (const [x, y] of list) g.fillRect(x, y, 1, 1);
  };
}

function rows(color: string, y: number, h: number): Painter {
  return (g, w) => {
    g.fillStyle = color;
    g.fillRect(0, y, w, h);
  };
}

const all =
  (...ps: Painter[]): Painter =>
  (g, w, h) => {
    for (const p of ps) p(g, w, h);
  };

export interface SealParts {
  group: THREE_NS.Group;
  /** Robbe ohne Eis */
  seal: THREE_NS.Group;
  ice: THREE_NS.Group;
  /** Kopf (dreht um den Hals) */
  head: THREE_NS.Group;
  /** Vordere Flossen [links, rechts] (drehen um den Ansatz) */
  fins: THREE_NS.Group[];
  /** Hintere Flossen */
  tailFins: THREE_NS.Group[];
  /** Augen zu/auf */
  setBlink: (closed: boolean) => void;
  dispose: () => void;
}

type Face = "px" | "nx" | "py" | "ny" | "pz" | "nz";

/**
 * Baut die Robbe. 1 Einheit = 1 Pixel; Gesamtgröße ≈ 32 × 15 × 20 (mit Eisblock). Kopf zeigt nach +X,
 * Unterseite der Robbe bei y = 0. Für die Szene skalieren (z. B. 1/16).
 */
export function buildSeal(THREE: typeof THREE_NS, palette: SealPalette = SEAL_COLORS): SealParts {
  C = palette;
  const geos: THREE_NS.BufferGeometry[] = [];
  const mats: THREE_NS.Material[] = [];
  const texs: THREE_NS.Texture[] = [];

  const tex = (w: number, h: number, paint: Painter) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    paint(c.getContext("2d")!, c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    texs.push(t);
    return t;
  };

  /** Quader w (x) × h (y) × d (z). Texturgrößen: ±x: d × h, ±y: w × d, ±z: w × h. */
  const box = (w: number, h: number, d: number, faces: Partial<Record<Face, Painter>>, fallback: Painter) => {
    const g = new THREE.BoxGeometry(w, h, d);
    geos.push(g);
    const dims: Record<Face, [number, number]> = { px: [d, h], nx: [d, h], py: [w, d], ny: [w, d], pz: [w, h], nz: [w, h] };
    const order: Face[] = ["px", "nx", "py", "ny", "pz", "nz"];
    const materials = order.map((k) => {
      const [tw, th] = dims[k];
      const m = new THREE.MeshLambertMaterial({ map: tex(tw, th, faces[k] ?? fallback) });
      mats.push(m);
      return m;
    });
    return new THREE.Mesh(g, materials);
  };

  const group = new THREE.Group();
  // Robbe ohne Eis (hüpft separat)
  const seal = new THREE.Group();
  group.add(seal);

  // ---------------------------------------------------------------- Körper (liegend)
  const body = box(
    16,
    7,
    10,
    {
      py: all(noisy(C.back, 0.018, 3), px(C.spot, [[3, 2], [4, 2], [9, 6], [12, 3]])),
      ny: noisy(C.belly, 0.018, 4),
      pz: all(noisy(C.body, 0.018, 5), rows(C.belly, 5, 2)),
      nz: all(noisy(C.body, 0.018, 6), rows(C.belly, 5, 2)),
      px: all(noisy(C.body, 0.018, 7), rows(C.belly, 5, 2)),
    },
    noisy(C.body, 0.018, 8),
  );
  body.position.set(0, 3.5, 0);
  seal.add(body);

  const tail = box(4, 4, 6, { py: noisy(C.back, 0.018, 9), ny: noisy(C.belly, 0.018, 10) }, all(noisy(C.body, 0.018, 11), rows(C.belly, 3, 1)));
  tail.position.set(-10, 2, 0);
  seal.add(tail);

  // ---------------------------------------------------------------- Kopf (erhoben, dreht um den Hals)
  const eyes: [number, number][] = [
    [1, 3],
    [2, 3],
    [1, 4],
    [2, 4],
    [5, 3],
    [6, 3],
    [5, 4],
    [6, 4],
  ];
  const faceBase = all(noisy(C.body, 0.015, 20), px(C.cheek, [[0, 6], [7, 6]]));
  const faceOpen = tex(8, 8, all(faceBase, px(C.eye, eyes), px(C.shine, [[1, 3], [5, 3]])));
  const faceShut = tex(8, 8, all(faceBase, px(C.eye, [[1, 4], [2, 4], [5, 4], [6, 4]])));
  const headMesh = box(8, 8, 8, { py: all(noisy(C.back, 0.018, 21), px(C.spot, [[5, 2]])), ny: noisy(C.belly, 0.018, 22) }, noisy(C.body, 0.018, 23));
  const faceMat = (headMesh.material as THREE_NS.MeshLambertMaterial[])[0];
  faceMat.map?.dispose();
  faceMat.map = faceOpen;

  const head = new THREE.Group();
  head.position.set(6, 6.5, 0); // Halsgelenk
  headMesh.position.set(3, 2.5, 0);
  head.add(headMesh);

  // Schnauze mit Nase und Schnurrhaar-Punkten (Vorderseite 6 × 3)
  const snout = box(
    3,
    3,
    6,
    {
      px: all(noisy(C.snout, 0.012, 30), px(C.nose, [[2, 0], [3, 0]]), px(C.whisker, [[1, 1], [4, 1], [0, 2], [5, 2]])),
    },
    noisy(C.snout, 0.012, 31),
  );
  snout.position.set(8.5, 0, 0);
  head.add(snout);
  seal.add(head);

  // ---------------------------------------------------------------- Flossen (Gruppen mit Drehpunkt am Ansatz)
  const fin = (seed: number) => box(5, 1, 3, {}, noisy(C.flipper, 0.02, seed));
  const fins: THREE_NS.Group[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(4, 1, s * 5);
    const m = fin(40 + s);
    m.position.set(1.5, -0.5, s * 1);
    g.add(m);
    g.rotation.y = -s * 0.45;
    seal.add(g);
    fins.push(g);
  }
  const tailFins: THREE_NS.Group[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(-12, 1, s * 1.2);
    const m = fin(50 + s);
    m.position.set(-2, -0.5, s * 1);
    g.add(m);
    g.rotation.y = -s * 0.5;
    seal.add(g);
    tailFins.push(g);
  }

  // ---------------------------------------------------------------- Eisblock (türkis)
  const ice = new THREE.Group();
  const iceTop: Painter = all(noisy(C.ice, 0.015, 60), px(C.iceLight, [[3, 3], [4, 3], [24, 5], [27, 14], [8, 15], [15, 2], [20, 17]]));
  const iceSide: Painter = all(noisy(C.iceSide, 0.02, 62), rows(C.iceLight, 0, 1), rows(C.iceDark, 2, 1));
  const block = box(32, 3, 20, { py: iceTop, ny: noisy(C.iceDark, 0.02, 63) }, iceSide);
  block.position.set(0, -1.5, 0);
  ice.add(block);
  group.add(ice);

  return {
    group,
    seal,
    ice,
    head,
    fins,
    tailFins,
    setBlink: (closed) => {
      const next = closed ? faceShut : faceOpen;
      if (faceMat.map !== next) {
        faceMat.map = next;
        faceMat.needsUpdate = true;
      }
    },
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
      faceOpen.dispose();
      faceShut.dispose();
    },
  };
}

/** Gleichmäßiges Licht wie bei Minecraft-Renders (Seiten leicht dunkler) + dezenter lila Rand. */
export function addSealLights(THREE: typeof THREE_NS, scene: THREE_NS.Scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(2, 5, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb48cff, 0.8);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
}

/**
 * Süße Animation, zustandslos: aus Zeit und „Freude“ (0 = ruhig, 1 = Hover) die Pose setzen.
 * - ruhig: Kopf minimal wippend, ab und zu Blinzeln (blink 0..1 von außen)
 * - Hover: Kopf hebt sich und nickt, vordere Flossen klatschen, Schwanzflossen wedeln, kleiner Hüpfer
 */
export function poseSeal(p: SealParts, t: number, joy: number, blink: boolean) {
  const flap = Math.sin(t * 14) * joy;
  p.head.rotation.z = 0.12 * joy + Math.sin(t * 7) * 0.08 * joy;
  p.head.rotation.y = Math.sin(t * 3.5) * 0.12 * joy;
  p.fins[0].rotation.x = -0.15 - flap * 0.55;
  p.fins[1].rotation.x = 0.15 + flap * 0.55;
  p.tailFins[0].rotation.y = 0.5 + Math.sin(t * 10) * 0.35 * joy;
  p.tailFins[1].rotation.y = -0.5 - Math.sin(t * 10) * 0.35 * joy;
  p.seal.position.y = Math.abs(Math.sin(t * 7)) * 1.2 * joy;
  p.setBlink(blink);
}
