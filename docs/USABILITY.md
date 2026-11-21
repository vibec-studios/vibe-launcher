# Usability: Einstieg für weniger erfahrene Spieler

Stand: 21.11.2026. Grundlage: Durchgang aller Neulings-Wege im Mock (`VITE_MOCK=1`, gebündelter Mock-Build mit
`vite preview`, headless Edge über CDP, 1440×900), jeweils vorher und nachher. Screenshots: `docs/images/usability/`.

## Simple Mode (neu)

**Ziel:** Simple ist der volle Launcher für normale Spieler – mit einfachen Wörtern („Spiel“ statt „Instanz“) und
Erklärungen. Ausgeblendet wird nur Experten- und Admin-Technik.

**Eine Stelle:** `src/lib/simple-mode.ts`

- `SIMPLE_HIDDEN`: Liste aller Funktionen, die Simple ausblendet
- `useExpert(feature)`: `true`, wenn die Funktion sichtbar ist (Experte oder nicht in der Liste)
- `simpleHides.nav | settingsTab | instanceTab | instanceArea`: Zuordnung von Navigation, Einstellungs-Tabs,
  Instanz-Einstellungs-Tabs und Instanz-Bereichen zu diesen Funktionen

Neue Experten-Funktion ausblenden: Schlüssel in `ExpertFeature` und `SIMPLE_HIDDEN` ergänzen, an der Stelle
`useExpert("…")` abfragen, Hinweis mit `ExpertHint` (siehe unten) setzen und die Tabelle hier ergänzen.

| Funktion (`ExpertFeature`) | Was im Simple Mode fehlt |
| --- | --- |
| `servers` | Seitenleiste „Server“, Seiten `/servers` und `/servers/$id` (zeigen eine Erklärung mit „Experten-Modus einschalten“), Menüeintrag „Als Server hosten“ |
| `java-runtime` | Einstellungen → Java-Installationen, Java-Downloads, Java-Overrides; Instanz-Tab „Java & Speicher“ (RAM gibt es dort als Leistungsstufe unter „Allgemein“) |
| `jvm-args` | JVM-Argumente (global) |
| `launch-hooks` | Start-Befehle/Wrapper (global und je Instanz) |
| `env-vars` | Umgebungsvariablen je Instanz |
| `game-logs` | Instanz-Bereich „Logs“, Einstellung „Log beim Start öffnen“ |
| `instance-files` | Instanz-Bereich „Dateien“ (Datei-Browser) |
| `downloads-storage` | Einstellungs-Tab „Downloads“ (parallele Downloads, CurseForge-Key, eigene Stores, Datenordner) |
| `api-keys` | Microsoft Client-ID, Hinweis auf CurseForge-Key in „Entdecken“ |
| `custom-stores` | Eigene Store-Quellen in „Entdecken“ |
| `update-channel` | Update-Kanal (Release/Dev) |
| `tech-details` | Dateipfade beim Launcher-Import, Herkunft von Client-Packs, technische Problemdetails im Beitreten-Dialog |

**Jetzt auch im Simple Mode sichtbar** (vorher ausgeblendet): volle Startseite (Weiterspielen, Welten/Server,
Freunde, Updates, beliebte Modpacks) plus Karte „Erste Schritte“, Navigation nach eigener Reihenfolge inkl. Skins
und Galerie, Kontextmenüs an Instanzen, Loader in Kacheln/Kopf (mit Erklärung), Modpack-Infos, „Mehr“-Menü der
Instanz, Backups, volle Inhaltsliste (Sortieren, Filter, Mod-Sets, Werkzeuge, eigene Dateien), Mod-Set-Neuigkeiten,
Gruppieren nach Loader/Version, Entdecken mit Quelle (Modrinth/CurseForge), Version/Loader-Filtern, Sortierung,
Ansicht und Datapacks, Einstellungs-Tabs „Arbeitsspeicher“ (RAM) und „Spiel“ (Fenster, Start, Sync, Backups),
Instanz-Tabs „Version & Loader“, „Fenster“, „Vibe“, „Verwalten“, alle Darstellungs-Optionen, Vibe-Funktionen,
Privatsphäre und Konto löschen, Discord-Details.

**Bleibt vereinfacht** (bewusst, weil hilfreich): „Neues Spiel“-Assistent nach Ziel (mit „Erweitert“ zum vollen
Dialog), Entdecken wählt automatisch ein passendes Ziel-Spiel und blendet Unpassendes aus, Absturz-Banner mit
„Automatisch beheben“ statt Logs, Leistungsstufe statt MB-Zahlen, einfache Wörter (`simple:`-Texte).

**Übergänge:** Umschalten ändert nur die Oberfläche (`ui_mode`), keine Daten. Geprüft: Instanz im Simple Mode
umbenannt, auf Experte gewechselt – Name bleibt, Logs/Dateien/Downloads/Java erscheinen; ein im Simple Mode
gesperrter Link (`?tab=logs`) zeigt „Inhalte“ und öffnet nach dem Wechsel den Logs-Bereich. Hinweise „gibt es im
Experten-Modus“ mit Umschalt-Knopf: `ExpertHint` (Einstellungen → Arbeitsspeicher, Instanz → Allgemein, Instanz →
Fenster, Anleitungen für Experten-Funktionen) und `ExpertGate` (Server-Seiten). Touren überspringen
Schritte mit `expert: true` im Simple Mode, Touren zu Experten-Anleitungen erscheinen dort nicht.

## Befunde nach Schwere

| # | Schwere | Befund | Status |
| --- | --- | --- | --- |
| 1 | hoch | Simple Mode war zu stark beschnitten: Backups, Galerie, Skins (nur übers Konto-Menü), Sortieren/Filtern, Mod-Sets, Datapacks, CurseForge, Kontextmenüs und Gruppen fehlten. Anleitungen sagten ständig „nur im Experten-Modus“. | umgesetzt (siehe oben) |
| 2 | hoch | Fachbegriffe ohne Erklärung: Loader, Fabric/Forge/NeoForge/Quilt, Instanz, Snapshot, RAM, Shader, Datapack. Im Experten-Dialog stand nur „Loader“. | umgesetzt: Glossar + Begriffs-Popover |
| 3 | hoch | Rohe Fehlermeldungen ohne nächsten Schritt („Netzwerkfehler: error sending request …“, „Dateifehler: … os error 112“); in „Entdecken“ nur „Konnte nicht geladen werden.“ | umgesetzt: verständlicher Hinweis + Original klein darunter |
| 4 | hoch | Offline: „Wird installiert in: Lädt …“ in „Entdecken“ hing dauerhaft, wenn die Spieleliste nicht geladen werden konnte. | behoben |
| 5 | hoch | Experten-Seiten waren im Simple Mode per Link oder Tour erreichbar, ohne Erklärung (Tour „Welt hosten“ endete auf der Server-Seite). | umgesetzt: Erklärseite + Tour-Schritte werden übersprungen |
| 6 | mittel | Moduswahl im Onboarding („Wie möchtest du den Launcher nutzen?“) mit Versprechen „keine Technik“ ließ erwarten, dass Mods fehlen. | umgesetzt: Frage nach Erfahrung („Ich bin neu hier“ / „Ich kenne mich aus“), klare Liste was Experte zusätzlich kann |
| 7 | mittel | Kein Hinweis, was man ohne gekauftes Minecraft tun soll. | umgesetzt: „Noch kein Minecraft: Java Edition? Auf minecraft.net kaufen“ |
| 8 | mittel | Nach dem Onboarding keine Orientierung, was als Nächstes kommt. | umgesetzt: Karte „Erste Schritte“ (Anmelden, erstes Spiel, Mods/Modpack, erstes Mal spielen, Link „Mit Freunden spielen“), mit Fortschritt, ausblendbar |
| 9 | mittel | Simple-Startseite zeigte nur ein Spiel und Ziel-Kacheln, keine Welten, Freunde oder Updates. | umgesetzt: volle Startseite |
| 10 | mittel | Gemischte Begriffe im Simple Mode („2 Instanzen“, „Bibliothek“ neben „Meine Spiele“). | umgesetzt (`simple:`-Texte) |
| 11 | niedrig | Modpack-Liste im Assistenten: Beschreibungen nicht übersetzt (teils Chinesisch), keine Angabe zu Größe/RAM-Bedarf. | offen |
| 12 | niedrig | Instanzseite zeigt bis zu sechs Hinweis-Chips nebeneinander (Probleme, Downloads, Modpack-Update, Mod-Sets, RAM, Datapacks) – für Neulinge viel auf einmal. | offen |
| 13 | niedrig | Vorschau-Skizze des Simple Mode im Onboarding zeigt noch die alte, kurze Navigation. | offen |
| 14 | niedrig | Glossar noch nicht an jeder Stelle (Filter-Überschriften in „Entdecken“, Inhaltstyp-Chips). | offen |

## Was umgesetzt wurde

- **Zentrale Simple-Liste** `src/lib/simple-mode.ts`; alle verstreuten `simple`-Sperren darauf umgestellt oder
  entfernt (Navigation, Instanz-Bereiche, Einstellungs-/Instanz-Tabs, Inhalte, Entdecken, Kopf, Menüs).
- **Glossar** (`src/features/help/glossary/`): 19 Begriffe de/en, eigene Seite „Begriffe erklärt“ in „Hilfe &
  Anleitungen“ (durchsuchbar), Popover-Komponente `<Term id="loader">…</Term>` mit Link ins Glossar. Eingesetzt im
  Instanz-Kopf (Loader, Simple), „Neue Instanz“ (Loader), Einstellungen (Arbeitsspeicher, Snapshots).
- **Erste Schritte** (`src/features/home/StarterCard.tsx`) auf der Startseite (v1 und v2): sichtbar im Simple Mode
  bis alles erledigt ist, im Experten-Modus nur für neue Nutzer; ausblendbar (`localStorage vl.starter.hidden`).
- **Verständliche Fehler** (`src/lib/errorHints.ts`): erkennt Netzwerk, Anmeldung, voller Datenträger,
  Zugriff verweigert, gesperrte Datei, fehlendes Java, beschädigte Downloads. Wirkt automatisch in `toast.error(err)`,
  `ErrorState` und den Abschnitten von „Entdecken“.
- **Onboarding**: Erfahrungsfrage statt Modus-Frage, neue Texte zum Simple Mode, Kauf-Link im Konto-Schritt.
- **Hinweise „im Experten-Modus“**: `src/features/simple/ExpertHint.tsx` (`ExpertHint`, `ExpertGate`).
- **Hilfe**: `expert`-Flag für Anleitungen und Tour-Schritte, Texte ohne veraltete Simple-Einschränkungen.

## Durchgespielte Wege

| Weg | Ergebnis | Screenshot |
| --- | --- | --- |
| Erster Start, Moduswahl | vorher abstrakt, jetzt Erfahrungsfrage | `before-onb-1.png`, `after-onb-1.png` |
| Microsoft-Login-Erklärung | gut (Browser, Passwort, Skins); Kauf-Hinweis ergänzt | `after-onb-2.png` |
| Startseite nach Onboarding | vorher Ein-Spiel-Seite, jetzt volle Seite + Erste Schritte | `before-home.png`, `after-home.png` |
| Erstes Spiel / Modpack | Assistent nach Ziel funktioniert gut (Befund 11 offen) | – |
| Mods installieren | Entdecken mit Ziel-Spiel, jetzt mit Filtern und Quellen | – |
| Instanz, Absturz | Absturz-Banner mit „Automatisch beheben“ war schon gut; jetzt volle Instanzseite | `before-simple-instance-crash.png`, `after-instance.png` |
| Begriff nachschlagen | Popover + Glossar | `after-term-popover.png`, `after-glossary.png` |
| Spiel-Einstellungen | Allgemein jetzt mit Updates und Verknüpfung, Fenster und Verwalten dazu | `after-isettings-general.png` |
| Einstellungen | Arbeitsspeicher mit Experten-Hinweis | `after-settings-memory.png` |
| Server (Experten-Funktion) | Erklärseite statt leerer/fremder Seite | `after-servers-gate.png` |
| Kein Internet | verständlicher Hinweis statt „Konnte nicht geladen werden.“ | `after-error-offline.png` |
| Vibe-Warteliste | Karte mit Erklärung „Warum eine Warteliste?“ war schon verständlich | – |
| Freund hinzufügen, Welt mit Freunden | Knopf „Freund hinzufügen“ gut sichtbar; „Welt hosten“ über Anleitung „Mit Freunden spielen?“ verlinkt | – |

## Offen / Nicht geprüft

- Echter Spielstart mit Download-Fortschritt (Minecraft/Java) nur im Mock, nicht mit echtem Backend.
- Fehlendes Java nur über Texterkennung abgedeckt (der Launcher lädt Java sonst selbst).
- Befunde 11–14.
- Ungenutzte Texte nach dem Umbau (`shome.*`, `simple.content.off`, `instances.col.version_simple`) können später
  entfernt werden.
