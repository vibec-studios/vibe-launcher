// ---------------------------------------------------------------- Feedback (commands/feedback.rs, docs/FEEDBACK.md)
export type FeedbackKind = "bug" | "idea" | "other";

export interface FeedbackDraft {
  kind: FeedbackKind;
  message: string;
  contact: string | null;
  locale: string;
  page: string | null;
  instance_id: string | null;
  attach_logs: boolean;
  /** IDs aus feedbackCapture / feedbackPickScreenshots */
  screenshots: string[];
  link_account: boolean;
}

export interface FeedbackImage {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  /** data:-URL (kleines JPEG) */
  thumb: string;
}

export interface FeedbackAvailableLog {
  name: string;
  bytes: number;
  kind: "launcher" | "game" | "crash";
}

export interface FeedbackLogPreview {
  name: string;
  original_bytes: number;
  bytes: number;
  truncated: boolean;
  redactions: number;
  /** Genau der gesendete Text */
  text: string;
}

export interface FeedbackPreview {
  token: string;
  endpoint: string;
  meta: Record<string, unknown>;
  logs: FeedbackLogPreview[];
  screenshots: FeedbackImage[];
  account: string | null;
  total_bytes: number;
}

export type FeedbackSendResult =
  | { status: "sent"; id: string; ticket: string }
  | { status: "rate_limited"; retry_after_secs: number | null; message: string | null }
  | { status: "rejected"; http: number; code: string | null; message: string | null }
  | { status: "offline"; message: string };
