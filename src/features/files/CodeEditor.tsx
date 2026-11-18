// CodeMirror-6-Editor für Textdateien im Datei-Bereich. Wird nur per `lazy(() => import("./CodeEditor"))` geladen,
// damit CodeMirror nicht im Haupt-Bundle landet. Steuerung von außen über `ref` (Inhalt holen, zu Zeile springen).
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, type StringStream, bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { json } from "@codemirror/lang-json";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { javascript } from "@codemirror/legacy-modes/mode/javascript";
import { tags as t } from "@lezer/highlight";
import type { FileLanguage, FileValidationError } from "@/lib/types";
import { useLang } from "@/i18n";

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

// Logs: „[12:00:01] [Render thread/WARN]“-Präfixe und Exceptions hervorheben
const logMode = {
  name: "log",
  token(stream: StringStream) {
    if (stream.match(/^\[[^\]]*\]/)) {
      const s = stream.current();
      return /ERROR|FATAL|SEVERE/.test(s) ? "invalid" : /WARN/.test(s) ? "keyword" : "meta";
    }
    if (stream.match(/^[\w.$]*(Exception|Error)\b:?/)) return "invalid";
    if (stream.sol() && stream.match(/^\s+at\s/)) {
      stream.skipToEnd();
      return "comment";
    }
    stream.next();
    return null;
  },
};

function languageExt(lang: FileLanguage): Extension {
  switch (lang) {
    case "log":
      return StreamLanguage.define(logMode);
    case "json":
      return json();
    case "json5":
      // JSON5 hat Kommentare/Schlüssel ohne Anführungszeichen – der JS-Modus hebt das korrekt hervor
      return StreamLanguage.define(javascript);
    case "toml":
      return StreamLanguage.define(toml);
    case "properties":
    case "ini":
      return StreamLanguage.define(properties);
    case "yaml":
      return StreamLanguage.define(yaml);
    case "javascript":
    case "snbt":
      // SNBT ({Name:"x",Count:1b}) ähnelt JS-Objekten – reicht für die Hervorhebung
      return StreamLanguage.define(javascript);
    default:
      return [];
  }
}

// Farben passend zur App (Akzent je Instanz über var(--accent))
const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName), t.attributeName], color: "#8fb4ff" },
  { tag: [t.string, t.special(t.string)], color: "#3fe0c5" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#ffb547" },
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "#c792ea" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#6b6b75", fontStyle: "italic" },
  { tag: [t.heading, t.typeName, t.className, t.namespace, t.labelName], color: "#ff8fb1", fontWeight: "600" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "#e4e4e7" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "#a1a1aa" },
  { tag: t.meta, color: "#a1a1aa" },
  { tag: t.invalid, color: "#ff5470" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "var(--color-panel)", color: "var(--color-text)", fontSize: "13px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6", overscrollBehavior: "contain" },
    ".cm-content": { caretColor: "var(--accent)", padding: "6px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in srgb, var(--accent) 32%, transparent) !important",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.035)" },
    ".cm-gutters": { backgroundColor: "var(--color-surface)", color: "var(--color-dim)", border: "none", borderRight: "1px solid var(--color-line)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,.05)", color: "var(--color-text)" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px", minWidth: "40px" },
    ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", color: "var(--color-dim)" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--color-surface3)", border: "1px solid var(--color-line2)", color: "var(--color-muted)", borderRadius: "0" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: "rgba(255,255,255,.12)", outline: "1px solid var(--color-line2)" },
    ".cm-selectionMatch": { backgroundColor: "rgba(255,255,255,.08)" },
    ".cm-searchMatch": { backgroundColor: "rgba(255,181,71,.22)", outline: "1px solid rgba(255,181,71,.5)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(255,181,71,.45)" },
    ".cm-errorLine": { backgroundColor: "rgba(255,84,112,.10)", boxShadow: "inset 2px 0 0 var(--color-danger)" },
    ".cm-errorMark": { textDecoration: "underline wavy var(--color-danger)", textUnderlineOffset: "3px" },
    // Suchleiste (Strg+F) im App-Stil: eckig, Inter, dunkle Felder
    ".cm-panels": { backgroundColor: "var(--color-surface)", color: "var(--color-text)", fontFamily: "var(--font-sans)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--color-line)" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--color-line)" },
    ".cm-panel.cm-search": { padding: "8px 36px 8px 10px", fontSize: "12px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" },
    ".cm-panel.cm-search br": { flexBasis: "100%", height: 0, content: '""' },
    ".cm-panel.cm-search input.cm-textfield": {
      backgroundColor: "var(--color-surface2)",
      border: "1px solid var(--color-line2)",
      color: "var(--color-text)",
      borderRadius: "0",
      height: "28px",
      padding: "0 8px",
      margin: "0",
      fontSize: "12px",
      fontFamily: "var(--font-mono)",
      outline: "none",
      width: "220px",
    },
    ".cm-panel.cm-search input.cm-textfield:focus": { borderColor: "var(--accent)" },
    ".cm-panel.cm-search .cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--color-surface2)",
      border: "1px solid var(--color-line)",
      color: "var(--color-text)",
      borderRadius: "0",
      height: "28px",
      padding: "0 10px",
      margin: "0",
      fontSize: "12px",
      fontWeight: "600",
      cursor: "pointer",
    },
    ".cm-panel.cm-search .cm-button:hover": { backgroundColor: "var(--color-surface3)", borderColor: "var(--color-line2)" },
    ".cm-panel.cm-search label": { display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--color-muted)", fontSize: "12px", margin: "0 4px" },
    ".cm-panel.cm-search input[type=checkbox]": { accentColor: "var(--accent)", margin: "0" },
    ".cm-panel.cm-search button[name=close]": {
      color: "var(--color-muted)",
      fontSize: "18px",
      top: "6px",
      right: "8px",
      background: "none",
      border: "none",
      cursor: "pointer",
    },
    ".cm-panel.cm-search button[name=close]:hover": { color: "#fff" },
    ".cm-tooltip": { backgroundColor: "var(--color-surface2)", border: "1px solid var(--color-line2)", color: "var(--color-text)" },
  },
  { dark: true },
);

const phrasesDe: Record<string, string> = {
  Find: "Suchen",
  Replace: "Ersetzen",
  next: "Weiter",
  previous: "Zurück",
  all: "Alle",
  "match case": "Groß/klein",
  regexp: "Regex",
  "by word": "Ganzes Wort",
  replace: "Ersetzen",
  "replace all": "Alle ersetzen",
  close: "Schließen",
  "current match": "aktueller Treffer",
  "replaced $ matches": "$ Treffer ersetzt",
  "replaced match on line $": "Treffer in Zeile $ ersetzt",
  "on line": "in Zeile",
  "Go to line": "Gehe zu Zeile",
  go: "Los",
  "Fold line": "Zeile einklappen",
  "Unfold line": "Zeile ausklappen",
  "folded code": "eingeklappter Code",
  unfold: "ausklappen",
  "Control character": "Steuerzeichen",
};

// Fehlerzeilen als Dekoration (von außen gesetzt)
const setErrors = StateEffect.define<FileValidationError[]>();

function buildErrors(doc: Text, errors: FileValidationError[]): DecorationSet {
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

const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setErrors)) deco = buildErrors(tr.state.doc, e.value);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

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
