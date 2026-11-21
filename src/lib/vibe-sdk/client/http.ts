import type { VlpackManifest } from "../types";

export type Query = Record<string, string | number | boolean | undefined | null>;
export interface RequestOptions {
  query?: Query;
  body?: unknown;
  auth?: boolean | "optional";
  binary?: boolean;
  /** FormData wird unverändert gesendet */
  form?: FormData;
  signal?: AbortSignal;
}

export const enc = encodeURIComponent;

export function packForm(o: { manifest: VlpackManifest; overrides?: Blob; icon?: Blob; visibility?: string; description?: string; changelog?: string }) {
  const f = new FormData();
  if (o.visibility) f.append("visibility", o.visibility);
  if (o.description) f.append("description", o.description);
  if (o.changelog) f.append("changelog", o.changelog);
  f.append("manifest", JSON.stringify(o.manifest));
  if (o.overrides) f.append("overrides", o.overrides, "overrides.zip");
  if (o.icon) f.append("icon", o.icon, "icon.png");
  return f;
}
