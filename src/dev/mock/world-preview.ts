import type { Channel } from "@tauri-apps/api/core";
import type { WorldPreviewInfo } from "@/features/instances/worldPreviewApi";
import type { Handlers } from "./util";

const info: WorldPreviewInfo = {
  seed: "-8723082139938645097",
  version: "1.21.11",
  data_version: 4671,
  play_seconds: 46_050,
  spawn: { x: 0, z: 0, dimension: "minecraft:overworld" },
  player: { x: -130, z: 147, dimension: "minecraft:overworld" },
};

const jobs = new Map<string, AbortController>();

function mapImage(isPlayer: boolean): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 257;
  const ctx = canvas.getContext("2d")!;
  for (let z = 0; z < 257; z++) {
    for (let x = 0; x < 257; x++) {
      const dx = x - (isPlayer ? 103 : 142);
      const dz = z - 117;
      const height = Math.hypot(dx + 24 * Math.sin(z / 38), dz * .8) + 9 * Math.sin(x / 9) + 4 * Math.cos(z / 5);
      const light = (x * 17 + z * 37 + x * z) % 11;
      ctx.fillStyle = height > 110 ? `rgb(50, ${107 + light}, 173)`
        : height > 103 ? `rgb(212, ${190 + light}, 140)`
        : height < 40 ? `rgb(86, ${111 + light}, 66)`
        : `rgb(101, ${145 + light}, 68)`;
      ctx.fillRect(x, z, 1, 1);
    }
  }
  return canvas.toDataURL("image/png").split(",")[1];
}

const handlers: Handlers = {
  world_preview_info: () => info,
  world_preview_render: async ({ center, dimension, ready }) => {
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const channel = ready as Channel<string>;
    jobs.set(id, controller);
    channel.onmessage(id);
    try {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 700);
        controller.signal.addEventListener("abort", () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      if (controller.signal.aborted) throw { kind: "cancelled" };
      const position = center === "player" ? info.player! : info.spawn!;
      return { png: mapImage(center === "player"), position: { ...position, dimension: (dimension as string | null) ?? position.dimension }, radius: 128 };
    } finally {
      jobs.delete(id);
      const { __TAURI_INTERNALS__: ipc } = window as unknown as {
        __TAURI_INTERNALS__: { runCallback: (id: number, message: { index: number; end: boolean }) => void };
      };
      ipc.runCallback(channel.id, { index: 0, end: true });
    }
  },
  world_preview_cancel: ({ id }) => jobs.get(id as string)?.abort(),
  world_preview_export: ({ path, png }) => {
    const link = document.createElement("a");
    link.href = `data:image/png;base64,${png}`;
    link.download = String(path);
    link.click();
  },
  world_preview_copy: ({ png }) => {
    const bytes = Uint8Array.from(atob(String(png)), (byte) => byte.charCodeAt(0));
    const type = "image/png";
    return navigator.clipboard.write([new ClipboardItem({ [type]: new Blob([bytes], { type }) })]);
  },
};

export default handlers;
