---
name: vibe-launcher-theme
description: Create custom themes for the Vibe Launcher (Minecraft launcher by Vibe Craft Studios). Use when someone asks for a Vibe Launcher theme, color scheme, look or design, or pastes this skill's link. Produces a .vibetheme file and a VIBE-THEME-1 code that any released launcher (1.0.0-beta.6 or newer) can import.
---

# Vibe Launcher themes

You design themes for the **Vibe Launcher**. A theme is a small JSON document. The user imports it in the launcher under
**Settings → Appearance → Custom themes → Import** (German UI: *Einstellungen → Darstellung → Eigene Themes →
Importieren*). Import accepts three forms: the raw JSON, a `VIBE-THEME-1:` code, or a `.vibetheme` file. This works in
every released launcher since 1.0.0-beta.6. No developer build is needed.

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

A theme **cannot** change the layout, add images, add fonts or run code. Custom background images are not part of
shared themes. If the user wants an image, tell them to set it themselves under Appearance → Background after
importing.

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
- `format` is exactly `"vibe-launcher-theme"` and `version` is `1`.
- `name` at most 40 characters.
- Colors are 6-digit hex, `#` plus six characters `0-9a-f`. No 3-digit shorthand, no alpha, no `rgb()`.
- Enum fields use exactly the listed values. Numbers are integers; out-of-range numbers are clamped.
- Missing fields fall back to the launcher defaults. Still, always write every field so the result is predictable.
- The whole input must stay under 20,000 characters.

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

## Delivering the theme

Always give the user:
1. The JSON in a code block (they can paste it directly into the import dialog).
2. If you can run code: save it as `<Name>.vibetheme` and run `node validate.mjs <file>` from this skill folder. The
   validator checks the theme and prints the `VIBE-THEME-1:` share code. Without a runtime, skip the code. Never
   hand-encode base64, a wrong character makes the code unusable.
3. One line on how to import (see top) and a one-sentence description of the look.

Offer 2–3 variations when the wish is open, e.g. a dark and a light version, or a calm and a bold one.

Examples are in `examples/`. `theme.schema.json` is a JSON Schema for editors and validators.
