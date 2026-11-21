/** Fehler der Vibe-API (einheitliches Format `{ error: { code, message } }`). */
export class VibeError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "VibeError";
  }
}
