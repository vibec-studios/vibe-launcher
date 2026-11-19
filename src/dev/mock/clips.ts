// Mock: Clips des Vibey Clients (docs/CLIPS.md §10). Kleines Test-Video (FFmpeg testsrc2, QSV) + Vorschaubilder unter
// ./assets/clips – nur im Mock-Build. Bearbeiten/Löschen ändern die Liste im Speicher und senden `clips://changed`.
// Screenshots: localStorage vl.mock.clips = "empty" -> keine Clips (Leerzustand).
import type { Clip } from "@/lib/types";
import { mockEmit, type Handlers } from "./util";
import video from "./assets/clips/demo.mp4?url";
import thumb1 from "./assets/clips/thumb1.jpg?url";
import thumb2 from "./assets/clips/thumb2.jpg?url";
import thumb3 from "./assets/clips/thumb3.jpg?url";
import thumb4 from "./assets/clips/thumb4.jpg?url";

const flag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

const now = Date.now();
const H = 3600_000;
const D = 24 * H;

const pad = (n: number) => String(n).padStart(2, "0");
function idAt(ms: number, reason: string) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}_${reason}`;
}

function clip(instance_id: string, at: number, reason: string, p: Partial<Clip>): Clip {
  return {
    instance_id,
    id: idAt(at, reason),
    video_path: video,
    thumbnail_path: null,
    created_at: at,
    duration_ms: 6000,
    size_bytes: 488_080,
    width: 1280,
    height: 720,
    fps: 30,
    reason,
    kills: null,
    highlight_ms: null,
    events: [],
    player: { name: "Alex", uuid: "1c2d3e4f-0000-4000-8000-000000000001" },
    mode: "multiplayer",
    server: null,
    world: null,
    minecraft: "1.21.11",
    loader: "fabric",
    client_version: "0.4.0",
    encoder: "h264_qsv",
    video_codec: "h264",
    audio_codec: "aac",
    kept: false,
    title: null,
    tags: [],
    ...p,
  };
}

// Die Länge im JSON entspricht dem Test-Video (6 s); Marken liegen deshalb innerhalb von 6 s.
let clips: Clip[] = [
  clip("survival", now - 25 * 60_000, "multikill", {
    thumbnail_path: thumb1,
    kills: 2,
    highlight_ms: 4600,
    events: [
      { t_ms: 2400, type: "kill", victim: "Steve" },
      { t_ms: 4600, type: "kill", victim: "Kai" },
    ],
    server: "play.example.net",
    title: "Bridge 1v2",
    tags: ["bedwars"],
    kept: true,
  }),
  clip("survival", now - 3 * H, "hotkey", { thumbnail_path: thumb2, mode: "singleplayer", world: "Neue Welt" }),
  clip("vanilla", now - D - 2 * H, "clutch", {
    thumbnail_path: thumb3,
    kills: 1,
    highlight_ms: 3900,
    events: [{ t_ms: 3900, type: "kill", victim: "Notch_Fan" }],
    // Server-Adresse bewusst nicht gespeichert (Server-Regel/Datenschutz) – nie ergänzen
  }),
  clip("vanilla", now - 3 * D, "death", { thumbnail_path: thumb4, events: [{ t_ms: 5200, type: "death" }], server: "pvp.example.org" }),
  // Ohne Vorschaubild (Spiel konnte keins schreiben) -> Platzhalter
  clip("survival", now - 9 * D, "kill", { kills: 1, events: [{ t_ms: 3000, type: "kill", victim: "Zombie_Pigman" }], mode: "hosting", world: "Insel" }),
];

const changed = (instance_id: string) => setTimeout(() => mockEmit("clips://changed", { instance_ids: [instance_id] }), 50);

const handlers: Handlers = {
  clips_list: ({ instanceId }) => (flag("vl.mock.clips") === "empty" ? [] : clips.filter((c) => !instanceId || c.instance_id === instanceId)),
  clip_update: ({ instanceId, id, kept, title, tags }) => {
    const i = clips.findIndex((c) => c.instance_id === instanceId && c.id === id);
    if (i < 0) throw { kind: "not_found", message: "Nicht gefunden: Clip" };
    const c = { ...clips[i] };
    if (typeof kept === "boolean") c.kept = kept;
    if (typeof title === "string") c.title = title.trim() || null;
    if (Array.isArray(tags)) c.tags = tags as string[];
    clips = clips.map((x, n) => (n === i ? c : x));
    changed(c.instance_id);
    return c;
  },
  clip_delete: ({ instanceId, id }) => {
    clips = clips.filter((c) => !(c.instance_id === instanceId && c.id === id));
    changed(String(instanceId));
    return null;
  },
  clip_open_folder: () => null,
  clips_watch: () => null,
};

export default handlers;
