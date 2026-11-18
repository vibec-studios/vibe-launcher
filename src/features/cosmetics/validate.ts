// Schnelle Vorprüfung einer `.vibey`-Datei vor dem Hochladen (Teilmenge von validateVibey aus
// vibe-backend/packages/shared – das Backend prüft beim Einreichen vollständig, SPEC §5).
import { COSMETIC_SLOTS } from "./types";

export const MAX_BYTES = 2 * 1024 * 1024;
const ID_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

export interface Check {
  ok: boolean;
  errors: string[];
  warnings: string[];
  json?: Record<string, unknown> & { kind?: string; id?: string; name?: { en?: string; de?: string }; description?: { en?: string; de?: string } };
}

export function checkVibey(text: string): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  const size = new TextEncoder().encode(text).length;
  if (size > MAX_BYTES) return { ok: false, errors: [`Datei größer als ${MAX_BYTES / 1024} KiB`], warnings };
  let j: Check["json"];
  try {
    j = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    return { ok: false, errors: [`Kein gültiges JSON: ${(e as Error).message}`], warnings };
  }
  if (!j || typeof j !== "object") return { ok: false, errors: ["Kein .vibey-Objekt"], warnings };
  if (j.format !== "vibey") errors.push('format muss "vibey" sein');
  if (j.formatVersion !== 1) errors.push(`formatVersion ${String(j.formatVersion)} wird nicht unterstützt (erwartet 1)`);
  if (j.kind !== "cosmetic" && j.kind !== "emote") errors.push('kind muss "cosmetic" oder "emote" sein');
  if (typeof j.id !== "string" || !ID_RE.test(j.id)) errors.push("id muss die Form namespace:pfad haben (a–z, 0–9, _ . -)");
  else if (j.id.startsWith("vibey:")) warnings.push("Der Namespace „vibey:“ ist für offizielle Items reserviert – nimm deinen eigenen.");
  if (!j.name?.en) errors.push("name.en (englischer Name) fehlt");
  const cosmetic = j.cosmetic as { slot?: string; cape?: unknown; shield?: unknown } | undefined;
  if (j.kind === "cosmetic") {
    if (!cosmetic?.slot || !(COSMETIC_SLOTS as readonly string[]).includes(cosmetic.slot)) errors.push(`cosmetic.slot fehlt oder ist ungültig (${COSMETIC_SLOTS.join(", ")})`);
    else if (!j.model && !(cosmetic.slot === "cape" && cosmetic.cape) && !(cosmetic.slot === "shield" && cosmetic.shield)) errors.push(`Für Slot „${cosmetic.slot}“ ist ein model nötig`);
  }
  const emote = j.emote as { animation?: string } | undefined;
  const anims = (j.animations ?? {}) as Record<string, unknown>;
  if (j.kind === "emote") {
    if (!emote?.animation) errors.push("emote.animation fehlt");
    else if (!anims[emote.animation]) errors.push(`Animation „${emote.animation}“ gibt es nicht`);
  }
  const textures = (j.textures ?? []) as Array<{ id?: string; png?: string }>;
  if (!Array.isArray(textures) || textures.some((t) => !t?.id || typeof t.png !== "string")) errors.push("textures: jede Textur braucht id und png (Base64)");
  if (!textures.length) warnings.push("Keine Texturen enthalten");
  return { ok: errors.length === 0, errors, warnings, json: j };
}
