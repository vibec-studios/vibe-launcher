export interface AppError {
  kind: "error" | "not_found" | "invalid" | "cancelled" | "not_configured" | "auth" | "network" | "io" | "json" | "zip";
  message: string;
}
