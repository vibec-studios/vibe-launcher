import { create } from "zustand";
import type { TourId } from "../types";

const KEY = "vl.help.tours";

export interface TourProgress {
  step: number;
  done: boolean;
  seen: boolean;
}

type ProgressMap = Partial<Record<TourId, TourProgress>>;

interface TourState {
  active: { id: TourId; step: number } | null;
  progress: ProgressMap;
}

function load(): ProgressMap {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

function save(p: ProgressMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    return;
  }
}

export const useTours = create<TourState>(() => ({ active: null, progress: load() }));

const listeners = new Set<(id: TourId, completed: boolean) => void>();

export function onTourEnd(fn: (id: TourId, completed: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function patch(id: TourId, p: Partial<TourProgress>) {
  const progress = { ...useTours.getState().progress };
  progress[id] = { step: 0, done: false, seen: true, ...progress[id], ...p };
  save(progress);
  useTours.setState({ progress });
}

export function tourProgress(id: TourId): TourProgress | undefined {
  return useTours.getState().progress[id];
}

export function startTour(id: TourId, opts: { resume?: boolean } = {}) {
  const prev = tourProgress(id);
  const step = opts.resume && prev && !prev.done ? prev.step : 0;
  patch(id, { seen: true, step });
  useTours.setState({ active: { id, step } });
}

export function autoStartTour(id: TourId): boolean {
  if (tourProgress(id)?.seen || useTours.getState().active) return false;
  startTour(id);
  return true;
}

export function goToStep(step: number) {
  const a = useTours.getState().active;
  if (!a) return;
  patch(a.id, { step });
  useTours.setState({ active: { id: a.id, step } });
}

export function endTour(completed: boolean) {
  const a = useTours.getState().active;
  if (!a) return;
  patch(a.id, completed ? { done: true, step: 0 } : {});
  useTours.setState({ active: null });
  for (const fn of listeners) fn(a.id, completed);
}

export function resetTourProgress() {
  save({});
  useTours.setState({ progress: {} });
}
