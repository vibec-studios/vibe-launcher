# Skills für KI-Assistenten

Mit diesen Skills können KI-Assistenten (Claude, ChatGPT, Gemini, Cursor …) Dinge für den Vibe Launcher bauen.

## Eigene Themes: `vibe-launcher-theme`

Die KI entwirft dir ein eigenes Theme, das du im normalen Launcher importieren kannst. Das geht ab 1.0.0-beta.6,
auch ohne Dev-Version.

**Einfach im Chat:** Gib der KI diesen Link und sag, was du willst:

```
https://raw.githubusercontent.com/vibec-studios/vibe-launcher/main/skills/vibe-launcher-theme/SKILL.md
Nimm diesen Skill und mach mir ein Vibe-Launcher-Theme: dunkel, Nether-Feeling, orange Akzente.
```

**Claude Code / Agenten mit Skill-Ordner:** Den Ordner `skills/vibe-launcher-theme` nach `~/.claude/skills/`
(oder `.claude/skills/` im Projekt) kopieren. Danach reicht „Mach mir ein Vibe-Launcher-Theme …“.

**Importieren:** Im Launcher *Einstellungen → Darstellung → Eigene Themes → Importieren*. Dort das JSON oder den
`VIBE-THEME-1:`-Code einfügen oder die `.vibetheme`-Datei öffnen.

Im Ordner liegen außerdem:
- `validate.mjs`: prüft ein Theme und erzeugt den Teilen-Code (`node validate.mjs "Mein Theme.vibetheme"`).
- `theme.schema.json`: das Format als JSON Schema.
- `examples/`: Beispiel-Themes.
