import type * as THREE_NS from "three";
import type { SealParts } from "./build";

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
