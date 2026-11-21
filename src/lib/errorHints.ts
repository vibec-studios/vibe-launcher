import type { AppError } from "./types";

export type ErrorHint = "network" | "auth" | "disk" | "access" | "locked" | "java" | "corrupt";

const PATTERNS: [ErrorHint, RegExp][] = [
  ["disk", /os error 112|no space left|nicht genügend speicher|speicherplatz|disk (is )?full/i],
  ["locked", /os error 32|used by another process|von einem anderen prozess/i],
  ["access", /os error 5\b|access is denied|zugriff verweigert|permission denied/i],
  ["java", /java nicht gefunden|keine gültige java|java not found|keine java-installation|java \d+ wird für diese/i],
  ["network", /netzwerkfehler|error sending request|dns error|timed out|zeitüberschreitung|connection (refused|reset|closed)|getaddrinfo|failed to lookup|no route to host|offline/i],
];

export function errorHint(e: unknown): ErrorHint | null {
  if (!e || typeof e !== "object") return typeof e === "string" ? match(e) : null;
  const err = e as Partial<AppError>;
  const msg = typeof err.message === "string" ? err.message : "";
  const byText = match(msg);
  if (byText) return byText;
  switch (err.kind as string | undefined) {
    case "network":
      return "network";
    case "auth":
      return "auth";
    case "zip":
    case "json":
      return "corrupt";
    default:
      return null;
  }
}

function match(msg: string): ErrorHint | null {
  for (const [hint, re] of PATTERNS) if (re.test(msg)) return hint;
  return null;
}
