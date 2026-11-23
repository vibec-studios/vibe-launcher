---
name: vibe-launcher-theme
description: Create custom themes for the Vibe Launcher (Minecraft launcher by Vibe Craft Studios). Use when someone asks for a Vibe Launcher theme, color scheme, look, design, button style or decoration (e.g. "an Iron Man theme with a Jarvis on the start page"), or pastes this skill's link. Produces a .vibetheme file plus a VIBE-THEME-1 code (values only, launcher 1.0.0-beta.6+) or a VIBE-THEME-2 code (palette, CSS and decorations, launcher 1.0.0-beta.9+).
---

# Vibe Launcher themes

You design themes for the **Vibe Launcher**. A theme is a JSON document. The user imports it in the launcher under
**Settings → Appearance → Custom themes → Import** (German UI: *Einstellungen → Darstellung → Eigene Themes →
Importieren*). Import accepts the raw JSON, a `VIBE-THEME-1:`/`VIBE-THEME-2:` code, or a `.vibetheme` file. The
dialog checks the theme, shows a preview and lists everything it removed. No developer build is needed.

There are two format versions:

| | version 1 | version 2 |
|---|---|---|
| Can change | theme settings (`values`) | `values` + own colors (`palette`), CSS for the launcher's parts (`css`), static HTML/SVG decorations (`slots`), `author`, `description` |
| Code | `VIBE-THEME-1:` | `VIBE-THEME-2:` |
| Launcher | 1.0.0-beta.6 or newer | **1.0.0-beta.9 or newer** |

Use version 1 when the wish is only about colors, corners, fonts and backgrounds, or when the user has an older
launcher. Use version 2 for button styles, glows, borders, shapes, animations or anything on the start page
(greetings, logos, HUDs). Themes are data: no JavaScript, nothing loaded from the internet.

Answer in the user's language. Ask at most one short question if the wish is unclear (mood, light or dark, favourite
color). Otherwise design straight away and offer variations afterwards.

## What a theme can change

| Field | Values | Effect |
|---|---|---|
| `theme` | `standard` `winter` `graphite` `light` `midnight` `ocean` `forest` `sunset` `sakura` `nether` `end` `retro` `pixel` `pixel_light` `contrast` | **Base palette**: canvas, surfaces, text and muted colors (see table below). Pick the preset closest to the wanted mood. |
| `accent` | hex `#rrggbb` | Buttons, highlights, selection, focus, progress |
| `tone` | `dark` `dim` `oled` `light` | Darkness of surfaces. Keep it matching the base preset (light presets → `light`). |
| `radius` | `square` `slight` `round` `custom` | Corner style. `custom` uses `radius_px` |
| `radius_px` | 0–24 | Corner radius in px when `radius` is `custom` |
| `contrast` | `normal` `high` | Stronger borders and text |
| `cards` | `flat` `outlined` `raised` `pixel` | Card style. `pixel` gives Minecraft-like stepped edges |
| `headings` | `default` `pixel` `pixel_all` | Pixel font for headings, or for headings and labels |
| `font` | `inter` `inter_tight` `system` `mono` | Body font |
| `font_scale` | 90–115 | Text size in percent |
| `status.ok` `status.warn` `status.danger` | hex | Success / warning / error colors |
| `glass` | 0–100 | Frosted-glass surfaces. Only visible with a background (`background.kind` ≠ `none`) |
| `sidebar_style` | `solid` `floating` `tinted` | Sidebar look. `tinted` uses the accent |
| `background.kind` | `none` `color` `gradient` `animated` | Window background behind the content |
| `background.color` | hex | For `kind: color` |
| `background.gradient` | `accent` `dusk` `ocean` `ember` `forest` `pixel` `custom` | For `kind: gradient`. `custom` uses the three fields below |
| `background.gradient_from` / `gradient_to` | hex | Custom gradient colors |
| `background.gradient_angle` | 0–360 | Custom gradient angle in degrees |
| `background.animated` | `aurora` `particles` `waves` `blocks` | For `kind: animated` |
| `background.dim` | 0–90 | Darkens the background in percent (keeps text readable) |
| `background.blur` | 0–40 | Blur of the background in px |

With `values` alone a theme **cannot** restyle single controls, add images, add fonts or run code. Version 2 adds
`palette`, `css` and `slots` (below). A theme can never run code, load files from the internet, add links or forms, or
change the account, confirmation, log-sharing or settings dialogs. Custom background images are not part of shared
themes; small images can be embedded in v2 as `data:` URLs.

### Base palettes

| `theme` | tone | canvas | surface | text | default accent | notes |
|---|---|---|---|---|---|---|
| `standard` | dark | `#070708` | `#0f0f11` | `#f4f4f6` | `#8b6cff` | neutral black |
| `winter` | dark | `#080b10` | `#0e1218` | `#eef4fa` | `#8fcbef` | cool blue greys, snow, seal with scarf, frost |
| `graphite` | dim | `#111113` | `#18181b` | `#f4f4f6` | `#e6e6ea` | neutral dark grey, monochrome |
| `light` | light | `#f5f5f9` | `#ffffff` | `#14161b` | `#6a4cf5` | clean light |
| `midnight` | oled | `#00010a` | `#070a17` | `#f1f3fb` | `#8aa0ff` | deep navy black |
| `ocean` | dark | `#06131c` | `#0b1c27` | `#ecf6fb` | `#3cc8ec` | blue-teal |
| `forest` | dark | `#07120a` | `#0d1b10` | `#eef6ee` | `#7fd36f` | green |
| `sunset` | dark | `#150a10` | `#1e1018` | `#fbf0f2` | `#ff7aa2` | warm rose |
| `sakura` | light | `#fdf3f6` | `#fffafc` | `#2a1720` | `#c8346f` | light pink |
| `nether` | dark | `#170606` | `#210b0a` | `#fbefec` | `#ff8a3d` | dark red |
| `end` | dark | `#0d0817` | `#150e22` | `#f3effb` | `#c39bff` | dark purple |
| `retro` | dim | `#181611` | `#201d17` | `#f6f1e4` | `#ffd23f` | warm brown, chunky buttons |
| `pixel` | dark | `#170e26` | `#221934` | `#f6f3ff` | `#ffb37d` | Minecraft pixel style |
| `pixel_light` | light | `#f5f4f1` | `#fffefc` | `#151419` | `#6a4cf5` | light pixel style |
| `contrast` | oled | `#000000` | `#0a0a0a` | `#ffffff` | `#ffd60a` | maximum contrast, accessibility |

`winter` only shows its snow, mascot and frost effects when the base `theme` is `winter`.

## File format

```json
{
  "format": "vibe-launcher-theme",
  "version": 1,
  "name": "Deep Sea",
  "values": {
    "theme": "ocean",
    "accent": "#4fd1ff",
    "tone": "dark",
    "radius": "round",
    "radius_px": 6,
    "contrast": "normal",
    "cards": "raised",
    "headings": "default",
    "font": "inter",
    "font_scale": 100,
    "status": { "ok": "#4fe0b0", "warn": "#ffc966", "danger": "#ff7187" },
    "glass": 35,
    "sidebar_style": "floating",
    "background": {
      "kind": "gradient",
      "gradient": "custom",
      "animated": "aurora",
      "color": "#06131c",
      "gradient_from": "#021826",
      "gradient_to": "#0b4f6c",
      "gradient_angle": 160,
      "dim": 40,
      "blur": 0
    }
  }
}
```

Rules the launcher enforces. A theme that breaks them is rejected as invalid:
- `format` is exactly `"vibe-launcher-theme"` and `version` is `1` or `2`.
- `name` at most 40 characters (`author` 40, `description` 200).
- Colors are 6-digit hex, `#` plus six characters `0-9a-f`. No 3-digit shorthand, no alpha, no `rgb()` in `values`
  and `palette` (inside `css` every CSS color syntax works).
- Enum fields use exactly the listed values. Numbers are integers; out-of-range numbers are clamped.
- Missing fields fall back to the launcher defaults. Still, always write every field so the result is predictable.
- A version 1 theme must stay under 20,000 characters. A version 2 file may be up to 1 MB (see limits).

## Version 2: palette, CSS, decorations

Add these fields next to `values` and set `"version": 2`:

```json
{
  "format": "vibe-launcher-theme",
  "version": 2,
  "name": "Iron Man",
  "author": "Your name",
  "description": "Red and gold, glowing angular buttons, an arc reactor greeting on the start page.",
  "values": { "...": "exactly as in version 1" },
  "palette": { "canvas": "#160506", "surface": "#220a0b", "text": "#fff1e0", "muted": "#e0b9a0" },
  "css": "[data-part=\"button-primary\"] { border-radius: 0; box-shadow: 0 0 14px rgb(255 176 32 / .45); }",
  "slots": { "home-hero": "<div class=\"jarvis\"><div class=\"line\">{{greeting}}, {{player}}.</div></div>" }
}
```

See `examples/Iron Man.vibetheme` (animated arc reactor, HUD lines) and `examples/Stiller See.vibetheme` (calm).

### palette

Optional surface colors (hex). Accent and status colors stay in `values`. The palette only applies while the user
keeps the theme's `tone`.

| key | used for |
|---|---|
| `frame` | window frame: sidebar and title bar |
| `canvas` | content area |
| `surface`, `surface2`, `surface3` | cards; raised/hover; pressed |
| `overlay` | menus and dialogs |
| `border`, `border2` | thin lines; stronger lines |
| `field` | input fields |
| `text`, `muted`, `dim` | main text; secondary text; hints |
| `on_accent` | text on accent-colored buttons (otherwise automatic black/white) |

Keep text readable: `text` needs at least 4.5:1 contrast against `canvas`, `surface` and `surface2`. Below 3:1 the
launcher drops the text color (and if needed the surfaces); `muted` below 2.2:1 and `on_accent` below 3:1 are dropped too.

### css: style the launcher's parts

Write normal CSS against **parts**, never against internal class names (those are not reachable). Every part is an
attribute: `[data-part="button-primary"]`. An element can carry several parts, `[data-part="button"]` matches all
buttons.

| part | element |
|---|---|
| `sidebar`, `nav-item` | sidebar and its entries (active entry: `[aria-current="page"]`) |
| `header` | title bar |
| `main` | content area |
| `home`, `home-header`, `home-hero` | start page, greeting row, "continue playing" card |
| `button`, `button-primary`, `button-accent`, `button-ghost`, `button-outline`, `button-subtle`, `button-danger` | buttons |
| `icon-button` | square icon buttons |
| `card` | cards (settings groups, "continue playing") |
| `instance-tile` | instance tiles in the library and on the start page |
| `dialog` | normal dialogs |
| `input` | text fields, selects |
| `tabs`, `tab`, `segmented` | tab bars, tabs (active: `[aria-selected="true"]`), segmented switches |
| `badge`, `chip` | small tags, chips |
| `progress`, `progress-bar` | progress bars |
| `switch`, `checkbox` | toggles (`[data-state="checked"]`), checkboxes (`[aria-checked="true"]`) |
| `section`, `section-title` | page sections and their headings |
| `empty` | empty states |
| `slot` with `[data-slot="home-hero"]` etc. | the root element of a decoration slot |

The launcher has two designs (v1 and v2 beta) with the same parts. To target one design use
`html[data-design="v2"] [data-part="card"]`. Other conditions on `html`: `[data-tone="light"]`, `[data-theme]`.

Allowed:
- Selectors with types, `.class`, `#id`, attributes, combinators (` `, `>`, `+`, `~`), common pseudo-classes
  (`:hover`, `:active`, `:focus-visible`, `:disabled`, `:checked`, `:first-child`, `:nth-child()`, `:not()`, `:is()`,
  `:where()`, `:has()` …) and the pseudo-elements `::before`, `::after`, `::placeholder`, `::selection`, `::marker`.
- `@media`, `@supports`, `@container`, `@keyframes` (animations!), `@font-face` with an embedded font.
- `:root { --my-color: #ff2a2a; }` defines variables for all themed elements.
- Colors, gradients, shadows, filters, transforms, `clip-path`, `calc()`, `var()`, `color-mix()`.
- Images only as `url(data:image/png|webp|gif|svg+xml;…)`. Fonts only in `@font-face` as
  `url(data:font/woff2;base64,…)` (also `woff`, `ttf`, `otf`). Quote multi-word font names: `font-family: "Iron Font"`.

Removed by the launcher (the validator lists every removal):
- `@import`, `@layer`, `@property`, `@namespace`, `@scope`, `@page`, nested rules (CSS nesting), `&`, `:host`.
- Any `url()` that is not an embedded `data:` image/font, `image-set()`, `attr()`, `expression()`, `javascript:`.
- `pointer-events`, `behavior`, `-moz-binding`, `-webkit-app-region`, `position: fixed`. `z-index` is clamped to −10…10.
- Class and id selectors only reach your own slot elements, not the launcher's internals.

Themed CSS never applies to the account page, sign-in, confirmation and permission dialogs, log sharing,
onboarding or the settings window. Do not try to style those.

### slots: decorations

Static HTML/SVG shown at fixed places. Decorations cannot be clicked and never cover controls.

| slot | where | size |
|---|---|---|
| `home-hero` | top of the start page | full width, max 360 px high |
| `home-side` | start page, top of the right column | column width, max 320 px high |
| `sidebar-top` | sidebar below the logo | sidebar width (60 px compact, ~230 px wide), max 160 px |
| `background` | layer behind the page content | whole content area |
| `corner-tl`, `corner-tr`, `corner-bl`, `corner-br` | corners of the content area, behind the content | 200 × 200 px |

Allowed elements: `div span p strong b em i small br img h1 h2 h3 h4 ul ol li hr sup sub mark code` and inline
`<svg>` with shapes (`path circle ellipse rect line polyline polygon g`), `text`/`tspan`, `defs`, gradients, `stop`,
`clipPath`, `mask`, `pattern`, `filter` + `fe…` primitives, `symbol`, `marker`, `use href="#id"`.
Attributes: `class`, `id`, `style` (same rules as `css`), SVG geometry and presentation attributes, `img src` only
`data:image/…`, references only `url(#id)`. Removed: scripts, `on…` handlers, `<a>`, forms, `foreignObject`,
`iframe`, media, SMIL animation (`animate`, `set`). Animate with `@keyframes` in `css` and classes on slot elements.
Style slot content with classes: `.jarvis { … }` in `css` matches `<div class="jarvis">` in a slot.

### placeholders

Text inside slots may contain placeholders. The launcher fills them as plain text (never HTML) and keeps them live.

| placeholder | value |
|---|---|
| `{{greeting}}` | "Good morning" / "Good afternoon" / "Good evening" in the launcher language |
| `{{player}}` | active Minecraft account name |
| `{{time}}` | current time (HH:MM) |
| `{{date}}` | date, e.g. "Monday, 23 November" |
| `{{friends_online}}` | number of friends online |
| `{{instances}}` | number of instances |
| `{{last_played}}` | name of the last played instance |
| `{{version}}` | launcher version |

### limits

| | limit |
|---|---|
| whole file | 1 MB |
| `css` | 700,000 characters, 1,500 rules, 40 `@keyframes`, 8 `@font-face` |
| fonts | 300 KB together (woff2 subset fonts stay small) |
| images | 200 KB each, 600 KB together |
| each slot | 260,000 characters, 600 nodes (2,000 for all slots), nesting depth 24 |
| share code | up to 60,000 characters; bigger themes are shared as a `.vibetheme` file |

## Design rules

1. **Start from the closest base preset** and keep its `tone`. The base palette decides surfaces and text, so the
   accent has to fit it.
2. **Accent contrast:** text on accent buttons uses the launcher's automatic dark or light label. On dark tones choose
   an accent with lightness of about 60–80 % (HSL). On `light` choose about 35–50 %. Avoid pure `#ffffff` or `#000000`
   accents, and avoid neon colors at full saturation on `oled`.
3. **Status colors** must stay recognisable: ok = green/teal, warn = amber/yellow, danger = red/pink. Shift them slightly
   toward the theme's hue, but never make warn and danger hard to tell apart. On light tones use darker status colors
   (e.g. `#086b53`, `#8f5300`, `#bd2536`).
4. **Backgrounds:** with `glass` > 0 use `dim` 30–60 so content stays readable. For a calm look use `gradient` with
   `custom` colors taken from the base canvas plus one accent-tinted stop. Use `animated` sparingly. Use `blur` only
   with busy backgrounds.
5. **Pixel looks:** `cards: "pixel"` + `headings: "pixel"` + `radius: "square"` + `font: "inter_tight"`. Pair this
   with `pixel`, `pixel_light` or `retro`.
6. **Accessibility:** for low-vision users use `contrast: "high"`, `font_scale` 110–115 and the `contrast` preset.
7. Give the theme a short, evocative name.

Version 2 rules:

8. **Style parts, keep the layout.** Change color, borders, radius, shadows, glow, letter-spacing, text-transform.
   Do not hide controls, do not change sizes drastically, never use `display: none` on parts. Buttons must stay
   recognisable and their labels readable.
9. **Glow with restraint:** one strong glow for primary actions, subtle edges elsewhere. Use `:hover` for the extra kick.
10. **Slots are decoration.** Keep `home-hero` around 100–220 px high, put the greeting there
    (`{{greeting}}, {{player}}.`), use SVG for logos and rings. Corners and background should be faint (opacity
    0.3–0.6) so content stays in front.
11. **Animate gently:** slow loops (5–20 s), `transform`/`opacity` only. The launcher stops animations when the user
    reduces motion.
12. Write slot texts in the user's language. Placeholders are filled in the launcher's language.

## Delivering the theme

Always give the user:
1. The JSON in a code block (they can paste it directly into the import dialog). For very large v2 themes (embedded
   fonts) give the file instead.
2. If you can run code: save it as `<Name>.vibetheme` and run `node validate.mjs "<Name>.vibetheme"` from this skill
   folder. The validator uses the launcher's own rules (files in `gen/`), lists everything the launcher would remove,
   and prints the `VIBE-THEME-1:` or `VIBE-THEME-2:` share code. Fix every "Angepasst" line it reports. Without a
   runtime, skip the code. Never hand-encode base64, a wrong character makes the code unusable.
3. One line on how to import (see top) and a one-sentence description of the look.
4. For version 2: say that it needs Vibe Launcher 1.0.0-beta.9 or newer. If the user has an older launcher, deliver a
   version 1 theme (only `values`) instead.
5. Mention the emergency exit once: **Ctrl+Shift+0** turns a custom theme off; holding **Shift** while starting the
   launcher starts without theme extensions.

Offer 2–3 variations when the wish is open, e.g. a dark and a light version, or a calm and a bold one.

Examples are in `examples/`. `theme.schema.json` is a JSON Schema for editors and validators.
