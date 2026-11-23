import { contrast } from "./gen/themes/palette.mjs";

const LIGHT = ["light", "sakura", "pixel_light"];

export const MESSAGES = {
  "css.at_rule": "@-Regel entfernt (erlaubt: @media, @supports, @container, @keyframes, @font-face)",
  "css.selector": "Selektor entfernt (ungültig, Namensraum, Verschachtelung oder data-vt-*)",
  "css.property": "Eigenschaft entfernt (nicht erlaubt, z. B. pointer-events, behavior, -moz-binding, app-region)",
  "css.value": "CSS-Wert entfernt (z. B. position: fixed, unbekannte Funktion, javascript:)",
  "css.url": "url() entfernt: nur data:image/png|webp|gif|svg+xml, Schriften nur data:font/woff2|woff|ttf|otf in @font-face",
  "css.nested": "Verschachtelte Regel entfernt (CSS-Nesting wird nicht unterstützt)",
  "css.limit": "CSS gekürzt (zu viele Regeln oder Angaben)",
  "css.font": "@font-face entfernt (font-family und eingebettete src nötig)",
  "markup.element": "Element entfernt (Skripte, Links, Formulare, foreignObject, Medien sind verboten)",
  "markup.attribute": "Attribut entfernt (Event-Handler und unbekannte Attribute sind verboten)",
  "markup.url": "Externe Quelle oder Link entfernt (nur data:-Bilder und #id-Verweise)",
  "markup.limit": "Deko gekürzt (Knoten- oder Tiefenlimit)",
  "markup.placeholder": "Unbekannter Platzhalter bleibt als Text stehen",
  "slot.unknown": "Unbekannter Deko-Platz ignoriert",
  "palette.key": "Unbekannte Palettenfarbe ignoriert",
  "palette.value": "Palettenfarbe ist kein #rrggbb",
  "contrast.low": "Wenig Kontrast (unter 4,5:1 für Text bzw. 3:1 für Nebentext)",
  "contrast.dropped": "Farben wegen zu wenig Kontrast verworfen",
  "image.too_big": "Bild entfernt (max. 200 KB je Bild, 600 KB gesamt)",
  "font.too_big": "Schrift entfernt (max. 300 KB gesamt)",
  "field.ignored": "Feld gibt es erst in version 2, ignoriert",
};

export const ERRORS = {
  empty: "Datei ist leer",
  too_long: "Theme ist zu groß (Datei max. 1 MB, CSS max. 700.000 Zeichen, Deko-Platz max. 260.000 Zeichen)",
  format: 'Kein gültiges Theme (JSON mit format "vibe-launcher-theme" oder VIBE-THEME-Code erwartet)',
  version: "version muss 1 oder 2 sein",
  values: "values enthält ungültige Werte (Enums, #rrggbb-Farben, Zahlen prüfen) oder css/slots sind keine Texte",
};

export function rawHints(data) {
  const out = [];
  if (!data || typeof data !== "object") return out;
  const v = data.values ?? {};
  for (const k of ["theme", "accent", "tone", "radius", "contrast", "cards", "headings", "font", "status", "sidebar_style", "background"]) {
    if (v[k] === undefined) out.push(`values.${k} fehlt (Standardwert wird genutzt)`);
  }
  if (data.version === 1 && (data.css || data.slots || data.palette)) out.push("css, slots und palette brauchen version 2");
  return out;
}

export function designHints(doc) {
  const out = [];
  const v = doc.values;
  if (LIGHT.includes(v.theme) !== (v.tone === "light")) out.push(`tone "${v.tone}" passt nicht zum Basis-Theme "${v.theme}"`);
  const canvas = doc.palette.canvas ?? (v.tone === "light" ? "#f5f5f9" : "#070708");
  if (contrast(v.accent, canvas) < 2) out.push("accent hebt sich kaum vom Hintergrund ab");
  if (v.glass > 0 && v.background.kind === "none") out.push("glass wirkt nur mit Hintergrund (background.kind ≠ none)");
  if (doc.css && !/data-part|data-slot|\.[a-z]/i.test(doc.css)) out.push("css spricht keine Parts an – nutze [data-part=…] oder Klassen aus den Deko-Plätzen");
  return out;
}
