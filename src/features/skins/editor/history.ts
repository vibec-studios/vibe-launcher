import type { Pixels } from "./pixels";

const LIMIT = 100;

export class History {
  private undoStack: Pixels[] = [];
  private redoStack: Pixels[] = [];

  push(state: Pixels) {
    this.undoStack.push(state.slice());
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: Pixels): Pixels | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(current.slice());
    return prev;
  }

  redo(current: Pixels): Pixels | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current.slice());
    return next;
  }

  dropLast() {
    this.undoStack.pop();
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
