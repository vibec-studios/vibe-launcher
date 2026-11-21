import { RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { FileValidationError } from "@/lib/types";

// Fehlerzeilen als Dekoration (von außen gesetzt)
export const setErrors = StateEffect.define<FileValidationError[]>();

export function buildErrors(doc: Text, errors: FileValidationError[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const seen = new Set<number>();
  const sorted = [...errors].sort((a, c) => a.line - c.line || a.column - c.column);
  for (const e of sorted) {
    if (e.line < 1 || e.line > doc.lines || seen.has(e.line)) continue;
    seen.add(e.line);
    const l = doc.line(e.line);
    b.add(l.from, l.from, Decoration.line({ class: "cm-errorLine" }));
    const from = Math.min(l.to, l.from + Math.max(0, e.column - 1));
    const to = Math.min(l.to, from + 1);
    if (to > from) b.add(from, to, Decoration.mark({ class: "cm-errorMark" }));
  }
  return b.finish();
}

export const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setErrors)) deco = buildErrors(tr.state.doc, e.value);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
