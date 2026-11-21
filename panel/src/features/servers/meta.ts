import type { Server, ServerRunState, ServerStatus, Software } from "@/api/types";

export const SOFTWARE_NAMES: Record<Software, string> = {
  vanilla: "Vanilla",
  paper: "Paper",
  purpur: "Purpur",
  folia: "Folia",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
};

export const SOFTWARE_COLORS: Record<Software, string> = {
  vanilla: "#5bbd4f",
  paper: "var(--text-2)",
  purpur: "#b77cff",
  folia: "#3fe0c5",
  fabric: "#dbb88d",
  quilt: "#7f6cf5",
  forge: "#e0743a",
  neoforge: "#f28e2b",
};

export function softwareOf(s: Server): Software {
  return s.platform?.kind ?? s.loader.kind;
}

export function usesPlugins(s: Server): boolean {
  return !!s.platform;
}

export function stateTone(state: ServerRunState | undefined): "ok" | "warn" | "danger" | "muted" {
  if (state === "running") return "ok";
  if (state === "starting" || state === "stopping") return "warn";
  if (state === "crashed") return "danger";
  return "muted";
}

export function isActive(st: ServerStatus | null | undefined): boolean {
  return !!st && (st.state === "running" || st.state === "starting" || st.state === "stopping");
}

export function joinAddress(st: ServerStatus | null | undefined): string | null {
  const t = st?.tunnel;
  if (t?.state === "online" && t.address) return t.address;
  return null;
}
