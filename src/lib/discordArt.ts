import type { Account, Settings } from "@/lib/types";
import { DEFAULT_APPEARANCE, normalizeAppearance } from "@/lib/appearance";

export type LargeArt = { kind: "logo" } | { kind: "icon"; motif: "seal" | "penguin" } | { kind: "head"; account: Account };
export type SmallArt = { kind: "head"; account: Account } | { kind: "loader" } | null;
export type ArtHint = "upload" | "account" | null;

export function headAccount(accounts: Account[] | undefined): Account | null {
  return accounts?.find((a) => a.active && a.kind === "microsoft") ?? null;
}

export function discordArt(s: Settings, head: Account | null): { large: LargeArt; small: SmallArt; hint: ArtHint } {
  const a = normalizeAppearance(s.appearance);
  const motif = a.app_icon === "penguin" ? "penguin" : "seal";
  const ownColor = a.app_icon_color.toLowerCase() !== DEFAULT_APPEARANCE.app_icon_color.toLowerCase();
  let large: LargeArt = { kind: "logo" };
  let hint: ArtHint = null;
  if (s.discord_large === "app_icon") {
    large = { kind: "icon", motif };
    if (a.app_icon === "custom" || ownColor) hint = "upload";
  } else if (s.discord_large === "custom") {
    hint = "upload";
  } else if (s.discord_large === "head") {
    if (head) large = { kind: "head", account: head };
    else hint = "account";
  }
  let small: SmallArt = s.discord_small === "none" ? null : { kind: "loader" };
  if (s.discord_small === "head") {
    if (head && large.kind !== "head") small = { kind: "head", account: head };
    else if (!head) hint ??= "account";
  }
  return { large, small, hint };
}
