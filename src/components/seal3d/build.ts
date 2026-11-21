import type * as THREE_NS from "three";
import { SEAL_COLORS, type SealPalette } from "./palette";
import { type Painter, all, noisy, px, rng, rows } from "./painters";

let C: SealPalette = SEAL_COLORS;

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
export function buildSeal(THREE: typeof THREE_NS, palette: SealPalette = SEAL_COLORS, opts: { winter?: boolean } = {}): SealParts {
  const winter = !!opts.winter;
  const none: Painter = () => {};
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
      py: all(
        noisy(C.back, 0.018, 3),
        px(C.spot, [[3, 2], [4, 2], [9, 6], [12, 3]]),
        // Winter: ein paar Schneeflocken sind auf dem Rücken liegen geblieben
        winter ? px(C.snow, [[1, 4], [2, 4], [2, 5], [6, 1], [7, 1], [11, 7], [12, 7], [13, 2], [5, 8]]) : none,
        winter ? px(C.snowShade, [[1, 5], [7, 2], [12, 8]]) : none,
      ),
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
  // Winter: kleines Schneehäubchen auf dem Kopf (Oberseite fast ganz weiß, Ränder ausgefranst)
  const headTop: Painter = winter
    ? all(
        noisy(C.back, 0.018, 21),
        (g) => {
          const r = rng(77);
          for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++) {
              const edge = Math.min(x, y, 7 - x, 7 - y);
              if (edge >= 2 || r() < (edge === 1 ? 0.75 : 0.3)) {
                g.fillStyle = r() < 0.2 ? C.snowShade : C.snow;
                g.fillRect(x, y, 1, 1);
              }
            }
        },
      )
    : all(noisy(C.back, 0.018, 21), px(C.spot, [[5, 2]]));
  const headMesh = box(8, 8, 8, { py: headTop, ny: noisy(C.belly, 0.018, 22) }, noisy(C.body, 0.018, 23));
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

  // ---------------------------------------------------------------- Winter: Strickschal
  if (winter) {
    // Einfarbig gestrickt (Rippen: jede zweite Spalte etwas dunkler); Wollweiß nur als Streifen an den Enden
    const knit = (seed: number, vertical = false, stripes: number[] = []): Painter =>
      all(noisy(C.scarf, 0.03, seed), (g, w, h) => {
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const row = vertical ? x : y;
            const col = vertical ? y : x;
            if (stripes.includes(row)) g.fillStyle = C.scarfStripe;
            else if (col % 2 === 1) g.fillStyle = C.scarfDark;
            else continue;
            g.fillRect(x, y, 1, 1);
          }
      });
    // Fransen: unterste Reihe abwechselnd Wollweiß/dunkel
    const fringe: Painter = (g, w, h) => {
      for (let x = 0; x < w; x++) {
        g.fillStyle = x % 2 ? C.scarfDark : C.scarfStripe;
        g.fillRect(x, h - 1, 1, 1);
      }
    };
    // Dicker Ring um den Hals (breiter als Körper/Kopf, damit er aufliegt)
    // Liegt tief am Hals und ragt vorn unter dem Kopf hervor -> auch in 34 px als Band erkennbar
    const ring = box(6, 3, 11, { py: knit(92, true) }, knit(93));
    ring.position.set(7.2, 6.1, 0);
    seal.add(ring);
    // Zwei herabhängende Enden vorn auf der Kamera-Seite: eins lang, eins kürzer und leicht schräg
    const endA = box(3, 5, 1, {}, all(knit(94, false, [2]), fringe));
    endA.position.set(9, 3.6, 5.2);
    endA.rotation.z = 0.05;
    seal.add(endA);
    const endB = box(2.5, 3.5, 1, {}, all(knit(95, false, [1]), fringe));
    endB.position.set(6.6, 4.3, 5.6);
    endB.rotation.z = -0.2;
    seal.add(endB);
  }

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
