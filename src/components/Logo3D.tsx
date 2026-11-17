// OWNER: Frontend-Agent A. 3D-Version des Website-Logos (Pixel-Block) mit three.js.
export function Logo3D({ size = 160 }: { size?: number; className?: string }) {
  return <img src="/logo.svg" width={size} height={size} alt="" draggable={false} />;
}
