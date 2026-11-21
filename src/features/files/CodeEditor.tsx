// CodeMirror-6-Editor für Textdateien im Datei-Bereich. Wird nur per `lazy(() => import("./CodeEditor"))` geladen,
// damit CodeMirror nicht im Haupt-Bundle landet. Steuerung von außen über `ref` (Inhalt holen, zu Zeile springen).
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, type Text } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import type { FileLanguage, FileValidationError } from "@/lib/types";
import { useLang } from "@/i18n";
import { errorField, setErrors } from "./editor/errors";
import { languageExt } from "./editor/languages";
import { phrasesDe } from "./editor/phrases";
import { highlight, theme } from "./editor/theme";

export interface CodeEditorHandle {
  getValue: () => string;
  /** Aktuellen Inhalt als „gespeichert“ markieren (Basis für dirty) */
  markClean: () => void;
  gotoLine: (line: number, column?: number) => void;
  focus: () => void;
}

export interface CodeEditorProps {
  initial: string;
  language: FileLanguage;
  readOnly?: boolean;
  /** Beim Öffnen fokussieren (Standard: ja, wenn bearbeitbar) */
  autoFocus?: boolean;
  /** Beim Öffnen direkt zu dieser Zeile springen */
  initialLine?: number | null;
  errors: FileValidationError[];
  onDirty: (dirty: boolean) => void;
  /** Inhalt geändert (entprellt) – für die Prüfung */
  onContent: (content: string) => void;
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const clean = useRef<Text | null>(null);
  const dirty = useRef(false);
  // Immer die neuesten Callbacks verwenden, ohne den Editor neu zu bauen
  const cb = useRef(props);
  cb.current = props;
  const lang = useLang((s) => s.lang);

  const goto = (line: number, column = 1) => {
    const v = view.current;
    if (!v) return;
    const l = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
    const pos = Math.min(l.to, l.from + Math.max(0, column - 1));
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    v.focus();
  };

  useImperativeHandle(ref, () => ({
    getValue: () => view.current?.state.doc.toString() ?? "",
    markClean: () => {
      if (!view.current) return;
      clean.current = view.current.state.doc;
      if (dirty.current) {
        dirty.current = false;
        cb.current.onDirty(false);
      }
    },
    gotoLine: goto,
    focus: () => view.current?.focus(),
  }));

  useEffect(() => {
    if (!host.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const state = EditorState.create({
      doc: props.initial,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
        languageExt(props.language),
        syntaxHighlighting(highlight),
        theme,
        errorField,
        EditorState.readOnly.of(!!props.readOnly),
        EditorView.editable.of(!props.readOnly),
        EditorState.phrases.of(lang === "de" ? phrasesDe : {}),
        // `data-allow-find`: globale Tastensperre (app/guards.ts) lässt Strg+F hier durch.
        // Strg+S blockt die Sperre immer – das Speichern übernimmt der Tab (window-Listener).
        EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", "data-allow-find": "true" }),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          const d = !!clean.current && !u.state.doc.eq(clean.current);
          if (d !== dirty.current) {
            dirty.current = d;
            cb.current.onDirty(d);
          }
          clearTimeout(timer);
          timer = setTimeout(() => cb.current.onContent(u.state.doc.toString()), 400);
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    clean.current = v.state.doc;
    if (props.initialLine) goto(props.initialLine);
    else if (props.autoFocus ?? !props.readOnly) v.focus();
    return () => {
      clearTimeout(timer);
      v.destroy();
      view.current = null;
    };
    // Editor wird pro Datei neu erzeugt (key im Elternteil) – Props danach bewusst nicht beobachtet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: setErrors.of(props.errors) });
  }, [props.errors]);

  return <div ref={host} className="selectable h-full min-h-0 overflow-hidden" />;
});

export default CodeEditor;
