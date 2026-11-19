// Adressen der Vibe-Dienste und der Umzug henny.dev → axolite (docs/DOMAINS.md). Die Rust-Seite
// (`src-tauri/src/domains.rs`) ist maßgeblich und getestet; hier nur, was das Frontend zum Anzeigen braucht.

/** Backend-API, Konten, Website */
export const API_URL = "https://vibe.axolite.app";
/** Website von Vibe (Einstellungen → Über) */
export const WEBSITE = "https://vibe.axolite.app/";
/** Anzeigetext der Website */
export const WEBSITE_LABEL = "vibe.axolite.app";
/** Offizieller Vibe Store (Standard-Store „Vibe Craft Studios“); früher https://vibec-studios.github.io/data/store.json */
export const STORE_URL = "https://vibe.axolite.app/api/v1/store.json";
/** Einladungslinks: `https://axolite.cc/j/<code>` */
export const INVITE_BASE = "https://axolite.cc/j/";
/** Domain der Relay-Adressen (`<name>.axolite.cc`) */
export const RELAY_DOMAIN = "axolite.cc";
/** Alte Domain der Relay-Adressen (`<name>.vibey.henny.dev`) */
export const LEGACY_RELAY_DOMAIN = "vibey.henny.dev";

/** Eingebauter Hinweis zum Umzug – dieselbe ID wie die Ankündigung des Backends (erscheint nur einmal). */
export const DOMAIN_MOVE_NOTICE = "domain-move-2026-11";

/** Hosts, unter denen Einladungslinks des offiziellen Backends liegen (neu und alt). */
const INVITE_HOSTS = ["axolite.cc", "vibe.axolite.app", "vibe.henny.dev"];
const CODE = /^[23456789abcdefghjkmnpqrstuvwxyz]{6,8}$/;

/** Code aus einem eingefügten Einladungslink (`https://axolite.cc/j/k3x9q2`, alt `https://vibe.henny.dev/j/…`,
 *  oder `vibelauncher://join/k3x9q2`). `null` = kein Einladungslink. */
export function parseInviteCode(text: string): string | null {
  const v = text.trim();
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.search) return null;
  let code = "";
  if (u.protocol === "https:" && INVITE_HOSTS.includes(u.hostname.toLowerCase()) && (u.port === "" || u.port === "443")) {
    code = u.pathname.match(/^\/j\/([^/]+)\/?$/)?.[1] ?? "";
  } else if (u.protocol === "vibelauncher:") {
    // vibelauncher://join/<code> -> host "join", path "/<code>"
    const parts = `${u.host}${u.pathname}`.split("/").filter(Boolean);
    if (parts.length === 2 && parts[0].toLowerCase() === "join") code = parts[1].toLowerCase();
  }
  return CODE.test(code) ? code : null;
}

/** Liegt die Adresse unter der alten Relay-Domain (`name.vibey.henny.dev[:port]`)? */
export function isLegacyRelayAddress(addr: string): boolean {
  const host = addr.trim().replace(/:\d+$/, "").replace(/\.$/, "").toLowerCase();
  return host.endsWith(`.${LEGACY_RELAY_DOMAIN}`) && host.length > LEGACY_RELAY_DOMAIN.length + 1;
}
