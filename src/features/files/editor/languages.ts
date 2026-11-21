import type { Extension } from "@codemirror/state";
import { StreamLanguage, type StringStream } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { javascript } from "@codemirror/legacy-modes/mode/javascript";
import type { FileLanguage } from "@/lib/types";

// Logs: „[12:00:01] [Render thread/WARN]“-Präfixe und Exceptions hervorheben
export const logMode = {
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

export function languageExt(lang: FileLanguage): Extension {
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
