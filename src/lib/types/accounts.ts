// ------------------------------------------------------------------ Accounts

export type AccountKind = "microsoft";

export type DiscordLarge = "logo" | "app_icon" | "head" | "custom";
export type DiscordSmall = "head" | "loader" | "none";

export interface Account {
  id: string;
  kind: AccountKind;
  username: string;
  uuid: string;
  skin_url: string | null;
  active: boolean;
  expires_at: number | null;
  needs_relogin: boolean;
}

export interface VaultWarning {
  account_id: string;
  username: string;
  message: string;
}

export interface OfflineOffer {
  instance_id: string;
  account_id: string | null;
  message: string;
}

export interface DeviceCode {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

// ------------------------------------------------------------------ Skins & Capes

export type SkinVariant = "classic" | "slim";

export interface ActiveSkin {
  id: string;
  url: string;
  variant: SkinVariant;
  /** PNG als data:-URL (null, wenn nicht ladbar) */
  data_url: string | null;
}

export interface Cape {
  id: string;
  alias: string;
  url: string;
  state: "ACTIVE" | "INACTIVE";
  data_url: string | null;
}

export interface SkinProfile {
  account_id: string;
  username: string;
  skin: ActiveSkin | null;
  capes: Cape[];
}

/** Eintrag der lokalen Skin-Bibliothek (`skins/` im Datenordner). */
export interface LibrarySkin {
  id: string;
  name: string;
  variant: SkinVariant;
  file: string;
  added_at: number;
  /** "file" | "account:<name>" | "player:<name>" | "import:<launcher>" */
  source: string | null;
  /** Zugeordnetes Mojang-Cape (UUID), z. B. aus der Modrinth App */
  cape_id?: string | null;
  data_url: string;
}
