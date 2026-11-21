import type { AppError } from "@/lib/types";

export const LOADERS: Record<string, string> = { vanilla: "Vanilla", fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" };
export const CLIENTS: Record<string, string> = { vibey: "Vibey Client", norisk: "NoRisk Client", "norisk-mini": "NoRisk Mini", essential: "Essential" };

export const errKind = (e: unknown) => (e as AppError | undefined)?.kind;
