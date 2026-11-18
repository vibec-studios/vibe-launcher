// Gemeinsamer Ansichtszustand der Inhalte-Liste je Instanz (bleibt beim Tab-Wechsel erhalten). So können die
// Hinweiszeile in der Kopfzeile und die Liste zusammenarbeiten („6 Updates“ -> Liste gefiltert auf Updates).
import { create } from "zustand";

export type ContentFilter = "all" | "enabled" | "disabled" | "updates";
export type ContentSort = "name" | "recent" | "size";

interface ContentView {
  /** Wurde für die Instanz schon nach Updates gesucht? */
  checked: Record<string, boolean>;
  /** Laufende Update-Aufgabe je Instanz */
  tasks: Record<string, string>;
  filter: Record<string, ContentFilter>;
  sort: ContentSort;
}

export const useContentView = create<ContentView>(() => ({ checked: {}, tasks: {}, filter: {}, sort: "name" }));

export const setContentFilter = (id: string, f: ContentFilter) => useContentView.setState((s) => ({ filter: { ...s.filter, [id]: f } }));
export const setContentSort = (sort: ContentSort) => useContentView.setState({ sort });
export const markUpdatesChecked = (id: string) => useContentView.setState((s) => ({ checked: { ...s.checked, [id]: true } }));
export const setUpdateTask = (id: string, taskId: string) => useContentView.setState((s) => ({ tasks: { ...s.tasks, [id]: taskId } }));
