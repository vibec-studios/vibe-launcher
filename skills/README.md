# Skills für KI-Assistenten

Mit diesen Skills können KI-Assistenten (Claude, ChatGPT, Gemini, Cursor …) Dinge für den Vibe Launcher bauen.

## Eigene Themes: `vibe-launcher-theme`

Die KI entwirft dir ein eigenes Theme, das du im normalen Launcher importieren kannst – auch ohne Dev-Version.

- **Format v1** (ab 1.0.0-beta.6): Farben, Ecken, Schrift, Karten, Seitenleiste, Hintergrund.
- **Format v2** (ab 1.0.0-beta.9): zusätzlich eigene Farbpalette, CSS für die Bausteine des Launchers (z. B.
  kantige, leuchtende Knöpfe) und Deko auf der Startseite und in der Seitenleiste (z. B. ein animierter
  Arc Reactor mit „Guten Abend, Steve.“). Ohne JavaScript, nichts wird nachgeladen.

**Einfach im Chat:** Gib der KI diesen Link und sag, was du willst:

```
https://raw.githubusercontent.com/vibec-studios/vibe-launcher/main/skills/vibe-launcher-theme/SKILL.md
Nimm diesen Skill und mach mir ein Iron-Man-Theme mit goldenen Knöpfen und einem Jarvis auf der Startseite.
```

**Claude Code / Agenten mit Skill-Ordner:** Den Ordner `skills/vibe-launcher-theme` nach `~/.claude/skills/`
(oder `.claude/skills/` im Projekt) kopieren. Danach reicht „Mach mir ein Vibe-Launcher-Theme …“.

**Importieren:** Im Launcher *Einstellungen → Darstellung → Eigene Themes → Importieren*. Dort das JSON oder den
`VIBE-THEME-1:`/`VIBE-THEME-2:`-Code einfügen oder die `.vibetheme`-Datei öffnen. Der Dialog zeigt eine Vorschau und
was beim Prüfen entfernt wurde. Notfall: **Strg+Umschalt+0** schaltet ein eigenes Theme sofort ab.

Im Ordner liegen außerdem:
- `validate.mjs`: prüft ein Theme mit denselben Regeln wie der Launcher und erzeugt den Teilen-Code
  (`node validate.mjs "Mein Theme.vibetheme"`, Node 18 oder neuer).
- `gen/`: der Prüf-Kern des Launchers, automatisch aus `src/lib/themes` erzeugt (`pnpm theme:skill`), nicht von
  Hand ändern.
- `theme.schema.json`: das Format als JSON Schema.
- `examples/`: Beispiel-Themes (v1: Creeper, Deep Sea, Kirschblüte; v2: Iron Man, Stiller See).

Ausführlich für Menschen: [docs/THEMES.md](../docs/THEMES.md).
