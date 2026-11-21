import * as THREE from "three";
import { addSealLights, buildSeal, poseSeal } from "./seal3d";

const LOGO_YAW = -1.05;
const LOGO_PITCH = 0.42;
const HOVER_YAW = -1.4;

export function animateMascot(
  canvas: HTMLCanvasElement,
  size: number,
  compact: boolean,
  winter: boolean,
  isBlinking: () => boolean,
  onIdle: () => void,
) {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  addSealLights(THREE, scene);
  const parts = buildSeal(THREE, undefined, { winter });
  parts.group.scale.setScalar(1 / 16);
  parts.ice.visible = !compact;
  const pivot = new THREE.Group();
  pivot.add(parts.group);
  pivot.rotation.y = LOGO_YAW;
  scene.add(pivot);

  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(compact ? parts.seal : pivot, true);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius * (compact ? 0.74 : 0.84);
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.1, 100);
  const dir = new THREE.Vector3(0, Math.sin(LOGO_PITCH), Math.cos(LOGO_PITCH));
  cam.position.copy(sphere.center).addScaledVector(dir, 10);
  cam.lookAt(sphere.center);

  let time = 0;
  let joy = 0;
  let yaw = LOGO_YAW;
  let hovered = true;
  let frame = 0;
  let last = performance.now();

  const draw = (now: number) => {
    frame = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    const k = 1 - Math.pow(0.004, dt);
    joy += ((hovered ? 1 : 0) - joy) * k;
    yaw += ((hovered ? HOVER_YAW : LOGO_YAW) - yaw) * k;
    if (!hovered && joy < 0.002 && Math.abs(yaw - LOGO_YAW) < 0.002) {
      onIdle();
      return;
    }
    poseSeal(parts, time, joy, isBlinking());
    pivot.rotation.y = yaw;
    renderer.render(scene, cam);
    frame = requestAnimationFrame(draw);
  };

  poseSeal(parts, 0, 0, isBlinking());
  renderer.render(scene, cam);
  frame = requestAnimationFrame(draw);
  return {
    hover(value: boolean) {
      hovered = value;
    },
    dispose() {
      cancelAnimationFrame(frame);
      parts.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
