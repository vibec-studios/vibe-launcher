// ------------------------------------------------------------------ Spiel-Links (docs/PLAY-LINKS.md)

export interface PlayLinkMod {
  source: "modrinth" | "curseforge";
  project_id: string;
  version_id?: string | null;
  kind?: "mod" | "resourcepack" | "shader" | "datapack";
}

export interface PlayLink {
  code: string;
  url: string;
  host: { uuid: string; name: string };
  relay_host: string;
  mc_version: string;
  loader: { kind: string; version: string | null };
  pack: { source: "modrinth" | "curseforge"; project_id: string; version_id: string; title: string | null } | null;
  mods: PlayLinkMod[];
  client_pack: string | null;
  world_name: string | null;
  max_players: number | null;
  /** Relay-Slot noch belegt (Host online) */
  active: boolean;
  expires_at: string;
  /** Geteiltes Vibe-Modpack am Link (feste Version) */
  vibe_pack?: PlayLinkVibePack | null;
}

export interface PlayLinkVibePack {
  code: string;
  version_id: string;
  version: string;
  name: string;
  icon_url: string | null;
  mc_version: string;
  loader: string;
  loader_version: string | null;
  file_count: number;
  latest_version_id: string | null;
  available: boolean;
}

export type JoinProblem = "version_unavailable" | "pack_unavailable" | "curseforge_unavailable" | "loader_unsupported";

export interface JoinPreview {
  instance_id: string | null;
  instance_name: string | null;
  create: boolean;
  pack_title: string | null;
  pack_icon: string | null;
  pack_version: string | null;
  mods: number;
  pack_files: number;
  client_pack: string | null;
  download_bytes: number | null;
  game_download: boolean;
  manual: string[];
  problem: JoinProblem | null;
  problem_detail: string | null;
  /** Vibe-Pack: vorhandene Instanz wird auf die Link-Version aktualisiert */
  pack_update?: boolean;
  pack_from_version?: string | null;
  vibe_pack?: boolean;
}

/** `<spielordner>/.vibe/session.json` (vom Vibey Client) */
export interface PlayLinkSession {
  schema: number;
  state: "menu" | "singleplayer" | "hosting" | "multiplayer";
  server: string | null;
  world: string | null;
  play_link: string | null;
  players: number | null;
  max_players: number | null;
  updated_at: number;
}

export interface RunningSession {
  instance_id: string;
  session: PlayLinkSession;
}
