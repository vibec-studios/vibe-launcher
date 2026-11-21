export type PropType = { kind: "bool" } | { kind: "number"; min?: number; max?: number } | { kind: "enum"; options: string[] } | { kind: "text"; placeholder?: string };

export interface PropMeta {
  key: string;
  group: "general" | "gameplay" | "world" | "technical";
  type: PropType;
  warn?: (value: string) => boolean;
}

export const PROPS: PropMeta[] = [
  { key: "motd", group: "general", type: { kind: "text" } },
  { key: "max-players", group: "general", type: { kind: "number", min: 1, max: 1000 } },
  { key: "white-list", group: "general", type: { kind: "bool" } },
  { key: "online-mode", group: "general", type: { kind: "bool" }, warn: (v) => v === "false" },
  { key: "gamemode", group: "gameplay", type: { kind: "enum", options: ["survival", "creative", "adventure", "spectator"] } },
  { key: "difficulty", group: "gameplay", type: { kind: "enum", options: ["peaceful", "easy", "normal", "hard"] } },
  { key: "hardcore", group: "gameplay", type: { kind: "bool" } },
  { key: "pvp", group: "gameplay", type: { kind: "bool" } },
  { key: "allow-flight", group: "gameplay", type: { kind: "bool" } },
  { key: "spawn-protection", group: "gameplay", type: { kind: "number", min: 0, max: 1000 } },
  { key: "enable-command-block", group: "gameplay", type: { kind: "bool" } },
  { key: "level-seed", group: "world", type: { kind: "text" } },
  { key: "level-name", group: "world", type: { kind: "text" } },
  { key: "generate-structures", group: "world", type: { kind: "bool" } },
  { key: "spawn-monsters", group: "world", type: { kind: "bool" } },
  { key: "spawn-animals", group: "world", type: { kind: "bool" } },
  { key: "allow-nether", group: "world", type: { kind: "bool" } },
  { key: "view-distance", group: "technical", type: { kind: "number", min: 2, max: 32 }, warn: (v) => Number(v) > 16 },
  { key: "simulation-distance", group: "technical", type: { kind: "number", min: 2, max: 32 } },
  { key: "player-idle-timeout", group: "technical", type: { kind: "number", min: 0, max: 1440 } },
];

export const GROUPS = ["general", "gameplay", "world", "technical"] as const;
