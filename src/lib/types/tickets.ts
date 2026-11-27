import type { ReportReason } from "@/lib/vibe-sdk/types";
import type { FeedbackImage, FeedbackLogPreview } from "./feedback";

export type TicketKind = "bug" | "idea" | "other" | "report";
export type TicketStatus = "new" | "in_progress" | "waiting" | "done" | "rejected";
export type TicketRequestType = "log" | "screenshot" | "crash_report" | "text";

export interface TicketSummary {
  id: string;
  ticket: string;
  kind: TicketKind;
  status: TicketStatus;
  excerpt?: string;
  app: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  unread: boolean;
  openRequests: number;
  canReply: boolean;
  local?: boolean;
}

export interface TicketAttachment {
  id: string;
  kind: "log" | "screenshot";
  filename: string;
  contentType: string;
  size: number;
  available: boolean;
  url: string | null;
  messageId: number | null;
  createdAt: string;
}

export interface TicketMessage {
  id: number;
  kind: "message" | "request" | "request_cancelled" | "status";
  author: { type: "user" | "team" | "system"; name: string };
  body: string;
  requestId: string | null;
  fulfills: string[];
  data: { from?: TicketStatus; to?: TicketStatus; type?: TicketRequestType } | null;
  attachments: TicketAttachment[];
  createdAt: string;
}

export interface TicketRequest {
  id: string;
  type: TicketRequestType;
  message: string | null;
  status: "open" | "fulfilled" | "cancelled";
  createdAt: string;
  fulfilledAt: string | null;
  fulfilledByMessageId: number | null;
  cancelledAt: string | null;
}

export interface TicketReport {
  reason: string;
  status: "open" | "resolved" | "dismissed";
  chatName: string | null;
  messages: number;
}

export interface TicketDetail extends Omit<TicketSummary, "excerpt"> {
  message: string;
  contact: string | null;
  channel: string;
  attachments: TicketAttachment[];
  report: TicketReport | null;
  messages: TicketMessage[];
  requests: TicketRequest[];
  userReadAt: string | null;
}

export interface TicketList {
  items: TicketSummary[];
  account: boolean;
  complete: boolean;
}

export interface LocalTicket {
  id: string;
  ticket: string;
  added: number;
}

export interface TicketPosted {
  message: TicketMessage;
  status: TicketStatus;
  fulfilled: string[];
}

export interface TicketReplyDraft {
  ticket: string;
  body: string;
  fulfills: string[];
  instance_id: string | null;
  logs: ("launcher" | "game" | "crash")[];
  screenshots: string[];
}

export interface TicketReplyPreview {
  token: string;
  ticket: string;
  body: string;
  logs: FeedbackLogPreview[];
  screenshots: FeedbackImage[];
  total_bytes: number;
}

export interface TicketAttachmentData {
  mime: string;
  text: string | null;
  data_url: string | null;
}

export interface ChatReportDraft {
  chat_id: string;
  message_ids: string[];
  reason: ReportReason;
  details: string | null;
  locale: string;
}

export interface TicketError {
  kind: string;
  http: number;
  code: string;
  message: string;
  retry_after: number | null;
  details: unknown;
}
