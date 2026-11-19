// Feedback-/Fehlerbericht-Dialog: überall per `openFeedback()` öffnen.
// Einstieg für andere Bereiche (Absturzanzeige, Autofix „nicht automatisch lösbar“):
//   openFeedback({ kind: "bug", instanceId, attachLogs: true, source: "crash" })
// Der Entwurf (Art, Text, Kontakt) bleibt beim Schließen und nach Fehlern erhalten und wird erst nach
// erfolgreichem Senden geleert.
import { create } from "zustand";
import { api } from "@/lib/api";
import type { FeedbackImage, FeedbackKind } from "@/lib/types";

export type FeedbackSource = "button" | "settings" | "crash" | "autofix";

export interface FeedbackOpenOptions {
  kind?: FeedbackKind;
  /** Betroffene Instanz vorwählen */
  instanceId?: string | null;
  /** Logs vorab anhaken (Absturz/Autofix) */
  attachLogs?: boolean;
  /** Woher der Dialog kommt (zeigt passenden Hinweis) */
  source?: FeedbackSource;
  /** Text vorbelegen, falls der Entwurf leer ist (z. B. Name der Diagnose) */
  message?: string;
}

interface FeedbackState {
  open: boolean;
  source: FeedbackSource;
  kind: FeedbackKind;
  message: string;
  contact: string;
  instanceId: string | null;
  attachLogs: boolean;
  linkAccount: boolean;
  /** Screenshot des Fensters von vor dem Öffnen */
  windowShot: FeedbackImage | null;
  attachWindow: boolean;
  /** Per Datei-Dialog gewählte Bilder */
  files: FeedbackImage[];
}

const DRAFT_KEY = "vl.feedback.draft";

function loadDraft(): Partial<Pick<FeedbackState, "kind" | "message" | "contact">> {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    if (v && typeof v === "object") return { kind: v.kind, message: String(v.message ?? ""), contact: String(v.contact ?? "") };
  } catch {
    /* egal */
  }
  return {};
}

function saveDraft(s: Pick<FeedbackState, "kind" | "message" | "contact">) {
  try {
    if (!s.message && !s.contact) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ kind: s.kind, message: s.message, contact: s.contact }));
  } catch {
    /* egal */
  }
}

const stored = loadDraft();

export const useFeedback = create<FeedbackState>(() => ({
  open: false,
  source: "button",
  kind: stored.kind === "idea" || stored.kind === "other" ? stored.kind : "bug",
  message: stored.message ?? "",
  contact: stored.contact ?? "",
  instanceId: null,
  attachLogs: true,
  linkAccount: true,
  windowShot: null,
  attachWindow: false,
  files: [],
}));

// Entwurf mitschreiben (nur Text-Felder; Bilder bleiben im Speicher von Rust)
useFeedback.subscribe((s, prev) => {
  if (s.kind !== prev.kind || s.message !== prev.message || s.contact !== prev.contact) saveDraft(s);
});

export function setFeedback(patch: Partial<FeedbackState>) {
  useFeedback.setState(patch);
}

let opening = false;

/** Dialog öffnen. Nimmt vorher einen Screenshot des Launchers auf (ohne den Dialog selbst). */
export async function openFeedback(opts: FeedbackOpenOptions = {}) {
  const cur = useFeedback.getState();
  const patch: Partial<FeedbackState> = {
    open: true,
    source: opts.source ?? "button",
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.instanceId !== undefined ? { instanceId: opts.instanceId } : {}),
    ...(opts.attachLogs !== undefined ? { attachLogs: opts.attachLogs } : {}),
    ...(opts.message && !cur.message.trim() ? { message: opts.message } : {}),
  };
  if (cur.open) return setFeedback(patch);
  if (opening) return;
  opening = true;
  try {
    const shot = await api.feedbackCapture().catch(() => null);
    if (cur.windowShot) void api.feedbackDiscard([cur.windowShot.id]).catch(() => {});
    setFeedback({ ...patch, windowShot: shot, attachWindow: shot ? cur.attachWindow && !!cur.windowShot : false });
  } finally {
    opening = false;
  }
}

export function closeFeedback() {
  setFeedback({ open: false });
}

/** Nach erfolgreichem Senden: Entwurf leeren (Rust hat die gesendeten Bilder schon verworfen). */
export function resetFeedback() {
  const s = useFeedback.getState();
  const ids = [s.windowShot, ...s.files].filter((x): x is FeedbackImage => !!x).map((x) => x.id);
  if (ids.length) void api.feedbackDiscard(ids).catch(() => {});
  setFeedback({ message: "", contact: "", kind: "bug", files: [], windowShot: null, attachWindow: false, instanceId: null, attachLogs: true, source: "button" });
}
