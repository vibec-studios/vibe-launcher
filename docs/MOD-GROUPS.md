# Mod-Gruppen, Schlagwörter, Pack-Mods und Abhängigkeiten aufräumen

Feature-Nummern 10 und 22 aus der Feature-Recherche (Welle 3).

## Was der Nutzer sieht (Tab „Inhalte“ einer Instanz)

- **Gruppen** (Knopf „Gruppen“ in der Werkzeugleiste): Gruppen anlegen (Name und Farbe), umbenennen, löschen.
  Je Gruppe gibt es „Nur diese Gruppe zeigen“, „Alle einschalten“ und „Alle ausschalten“. Beim Löschen einer
  Gruppe bleiben die Mods installiert und behalten ihren An/Aus-Zustand.
- **Zuordnen**: Rechtsklick- und „⋮“-Menü einer Zeile → „Zu Gruppe“ (vorhandene Gruppe, „Neue Gruppe …“,
  „Aus Gruppe nehmen“). Bei Mehrfachauswahl gibt es in der schwebenden Leiste „Ordnen“ mit denselben Punkten.
- **Schlagwörter** (nur Experten-Modus): „Schlagwörter …“ im Zeilenmenü, Filter „Alle Schlagwörter ▾“,
  bis zu zwei Schlagwörter als Etikett in der Zeile.
- **Pack-Mods getrennt**: Bei Modpack-Instanzen (mit `pack.json`) erscheinen die Filter „Aus dem Modpack“ und
  „Von dir“. Selbst hinzugefügte Einträge tragen das Etikett „Von dir“.
- **Abhängigkeiten**: Automatisch mitinstallierte Mods tragen das Etikett „Abhängigkeit“ (Tooltip: wer sie braucht).
  Werden sie nicht mehr gebraucht, heißt das Etikett „Nicht mehr gebraucht“, über der Liste erscheint ein Hinweis
  mit „Aufräumen …“ und es gibt den Filter „Nicht mehr gebraucht“. Im Aufräumen-Dialog lassen sie sich entfernen
  oder „behalten“ (dann gelten sie als eigene Mod und der Hinweis verschwindet).
- **Entfernen**: Wird eine Mod entfernt, deren Abhängigkeiten danach niemand mehr braucht, zeigt der
  Bestätigungsdialog diese Abhängigkeiten mit Haken an („Entfernen (+2)“). Haken weg = bleibt installiert.
- Simple Mode: alles außer Schlagwörtern ist sichtbar; der Begriff „Abhängigkeit“ ist im Glossar erklärt.

## Daten

`instances/<id>/organize.json` (eigene Datei statt `instance.json`, damit Schreibzugriffe nicht mit dem
Instanz-Speicher und `content.json` kollidieren):

```json
{
  "format": 1,
  "groups": [{ "id": "a1b2c3d4e5f6", "name": "Grafik", "color": "#5b8def", "created": 1795250000000 }],
  "members": { "modrinth:AANobbMI": "a1b2c3d4e5f6", "file:mods/eigene.jar": "a1b2c3d4e5f6" },
  "tags": { "modrinth:AANobbMI": ["fps"] },
  "auto": { "modrinth:P7dR8mSH": { "required_by": ["modrinth:mOgUt4GM"], "installed_at": 1795250000000 } }
}
```

Schlüssel eines Eintrags: `<quelle>:<projekt-id>`, wenn die Herkunft im Content-Index bekannt ist (bleibt bei
Updates gleich), sonst `file:<ordner>/<dateiname ohne .disabled>`.

- **Pack-Herkunft** kommt aus `pack.json` (Pfade der Pack-Dateien und Overrides sowie deren Projekte).
- **Auto-Abhängigkeit**: `content_install` markiert alle mitgeplanten Nicht-Wurzel-Projekte als `auto` und hebt die
  Markierung des gewählten Projekts auf. `content_update` markiert neue Abhängigkeiten, lässt Wurzeln unverändert.
  `required_by` sammelt die Pflicht-Abhängigkeiten aus den Versionsdaten.
- **„Nicht mehr gebraucht“**: Erreichbarkeit im Abhängigkeitsgraph ab allen nicht-automatischen Mods. Kanten kommen
  aus `required_by` und aus den Metadaten der Mod-Dateien (`fabric.mod.json`/`mods.toml`: Pflicht-Abhängigkeit
  → `mod_id`/`provides`). Zyklen zwischen Abhängigkeiten werden korrekt erkannt.

## Tauri-Befehle (`src-tauri/src/commands/organize.rs`)

| Befehl | Argumente | Rückgabe |
|---|---|---|
| `content_organize` | `instanceId` | `Organize` |
| `content_group_save` | `instanceId, groupId?, name, color?, targets?` | `Organize` |
| `content_group_delete` | `instanceId, groupId` | `Organize` |
| `content_group_assign` | `instanceId, targets, groupId?` (`null` = aus Gruppe nehmen) | `Organize` |
| `content_tags_edit` | `instanceId, targets, add, remove` | `Organize` |
| `content_deps_keep` | `instanceId, targets` | `Organize` |
| `content_removal_extras` | `instanceId, targets` | `RemovalExtra[]` |

`targets` = `[{ kind, file_name }]`. Typen und Wrapper: `src/features/content/organize/api.ts`.
Mock: `src/dev/mock/organize.ts`.

## Grenzen

- Abhängigkeiten, die vor diesem Feature installiert wurden, sind nicht als „automatisch“ markiert.
- Installationen über Mod-Sets, Performance-Mods, Client-Packs und Auto-Fix markieren (noch) keine Abhängigkeiten.
- Gruppen sind eine Ansicht/Filter, keine echten Unterordner im `mods/`-Ordner.
