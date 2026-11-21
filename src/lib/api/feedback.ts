import { call } from "./call";
import type * as T from "../types";

export const feedbackApi = {
  // ---------------------------------------------------------------- Feedback (commands/feedback.rs)
  /** Screenshot des Launcher-Fensters (nur im Speicher, bis gesendet/verworfen) */
  feedbackCapture: () => call<T.FeedbackImage>("feedback_capture"),
  /** Öffnet den Datei-Dialog in Rust; liefert angenommene Bilder + Fehler für abgelehnte Dateien */
  feedbackPickScreenshots: (title: string) => call<{ images: T.FeedbackImage[]; errors: string[] }>("feedback_pick_screenshots", { title }),
  feedbackDiscard: (ids: string[]) => call<void>("feedback_discard", { ids }),
  feedbackLogs: (instanceId: string | null) => call<T.FeedbackAvailableLog[]>("feedback_logs", { instanceId }),
  feedbackPreview: (draft: T.FeedbackDraft) => call<T.FeedbackPreview>("feedback_preview", { draft }),
  feedbackSend: (token: string) => call<T.FeedbackSendResult>("feedback_send", { token }),
};
