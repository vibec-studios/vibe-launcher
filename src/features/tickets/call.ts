import { errorMessage } from "@/lib/api";
import type { TicketError } from "@/lib/types";
import { t } from "@/i18n";

async function client() {
  try {
    const { vibeClient } = await import("@/features/social/service");
    return vibeClient();
  } catch {
    return null;
  }
}

export function asTicketError(e: unknown): TicketError | null {
  if (e && typeof e === "object" && "code" in e && "http" in e) return e as TicketError;
  return null;
}

function isExpired(e: unknown) {
  const x = asTicketError(e);
  return x?.kind === "auth" && (x.code === "token_expired" || x.code === "invalid_token");
}

export async function ticketCall<T>(fn: () => Promise<T>): Promise<T> {
  const c = await client();
  await c?.accessToken().catch(() => null);
  try {
    return await fn();
  } catch (e) {
    if (!isExpired(e) || !c) throw e;
    await c.refresh().catch(() => {
      throw e;
    });
    return fn();
  }
}

export function ticketErrorText(e: unknown): string {
  const x = asTicketError(e);
  if (!x) return errorMessage(e);
  if (x.kind === "network") return t("tk.err.offline");
  if (x.http === 429 || x.code === "rate_limited") {
    const mins = x.retry_after ? Math.ceil(x.retry_after / 60) : 0;
    return mins > 1 ? t("tk.err.rate_min", { n: mins }) : t("tk.err.rate");
  }
  if (x.http === 413 || x.code === "payload_too_large") return t("tk.err.too_large");
  if (x.http === 401 || x.kind === "auth") return t("tk.err.auth");
  if (x.http >= 500) return t("tk.err.server", { code: x.http });
  const known: Record<string, string> = {
    ticket_closed: "tk.err.closed",
    limit_reached: "tk.err.limit",
    conflict: "tk.err.conflict",
    not_found: "tk.err.not_found",
    no_access: "tk.err.no_access",
    preview_expired: "tk.err.expired",
  };
  return known[x.code] ? t(known[x.code]) : x.message;
}

export function conflictTicket(e: unknown): string | null {
  const x = asTicketError(e);
  if (x?.http !== 409 || x.code !== "conflict") return null;
  const d = x.details as { ticket?: unknown } | null;
  return typeof d?.ticket === "string" ? d.ticket : null;
}
