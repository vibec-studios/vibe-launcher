import { Channel, invoke } from "@tauri-apps/api/core";

export type MapCenter = "spawn" | "player";

export interface WorldPosition {
  x: number;
  z: number;
  dimension: string;
}

export interface WorldPreviewInfo {
  seed: string | null;
  version: string | null;
  data_version: number | null;
  play_seconds: number | null;
  spawn: WorldPosition | null;
  player: WorldPosition | null;
}

export interface WorldMapPreview {
  png: string;
  position: WorldPosition;
  radius: number;
}

export const worldPreviewApi = {
  info: (instanceId: string, folder: string) =>
    invoke<WorldPreviewInfo>("world_preview_info", { instanceId, folder }),
  render: (instanceId: string, folder: string, center: MapCenter, signal: AbortSignal) => {
    let id: string | undefined;
    const cancel = () => {
      if (id) void invoke("world_preview_cancel", { id }).catch(() => {});
    };
    const ready = new Channel<string>((job) => {
      id = job;
      if (signal.aborted) cancel();
    });
    signal.addEventListener("abort", cancel, { once: true });
    return invoke<WorldMapPreview | null>("world_preview_render", { instanceId, folder, center, ready })
      .finally(() => signal.removeEventListener("abort", cancel));
  },
  copy: (png: string) => invoke<void>("world_preview_copy", { png }),
  export: (path: string, png: string) => invoke<void>("world_preview_export", { path, png }),
};
