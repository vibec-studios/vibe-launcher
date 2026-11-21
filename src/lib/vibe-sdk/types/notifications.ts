// ---------- Benachrichtigungen / Meldungen ----------

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

export type ReportReason = "spam" | "harassment" | "cheating" | "inappropriate" | "impersonation" | "malware" | "other";

export interface CreateReportBody {
  targetType: "message" | "user" | "pack";
  targetId: string;
  reason: ReportReason;
  details?: string;
}
