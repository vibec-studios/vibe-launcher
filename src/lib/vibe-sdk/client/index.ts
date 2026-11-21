// Übernommen aus @vibe-craft/sdk 0.1.0 (vibe-backend/packages/sdk/src/client.ts, MIT). Nur Importpfade angepasst.
import { VibeMediaClient } from "./media";

export { VibeError } from "./errors";
export { MemoryTokenStore } from "./tokens";
export type { StoredTokens, TokenStore, VibeClientOptions } from "./tokens";

/**
 * REST-Client für die Vibe-API. Erneuert Access-Tokens automatisch (eine Erneuerung gleichzeitig),
 * wiederholt Anfragen nach `token_expired` einmal und meldet endgültigen Login-Verlust über `onAuthLost`.
 */
export class VibeClient extends VibeMediaClient {}
