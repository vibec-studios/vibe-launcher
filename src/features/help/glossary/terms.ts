export const TERMS = [
  "instance",
  "modpack",
  "mod",
  "loader",
  "vanilla",
  "fabric",
  "quilt",
  "forge",
  "neoforge",
  "resourcepack",
  "shader",
  "datapack",
  "ram",
  "java",
  "snapshot",
  "server",
  "backup",
  "vibe",
  "account",
  "dependency",
  "portable",
  "telemetry",
  "skinlayer",
  "skinmodel",
] as const;

export type TermId = (typeof TERMS)[number];

export interface TermText {
  title: string;
  text: string;
  example?: string;
}

export type Glossary = Record<TermId, TermText>;
