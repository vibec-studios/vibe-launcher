# Log4Shell-Schutz (CVE-2021-44228 / CVE-2021-45046)

Code: `src-tauri/src/minecraft/log4shell.rs` (Versionsbereiche, Argumente, Erkennung, Tests).

## Spiel (Client)

- Der Start übernimmt Mojangs `logging.client`-Konfiguration aus der Versions-JSON (`install.rs` `vanilla_items`,
  `launch.rs` `build`). Das ist Mojangs offizieller Fix für alte Versionen.
- Zusätzlich hängt der Launcher immer `-Dlog4j2.formatMsgNoLookups=true` an (außer der Nutzer setzt die Option selbst).
- Fehlt bei einer Version vor 1.18.1 die `logging`-Konfiguration (kaputte/importierte Version-JSON), steht eine Warnung
  im Launcher-Log. Bei 1.7–1.11 wirkt die JVM-Option nicht (Log4j 2.0-beta9), dort hilft nur „Instanz reparieren“.

## Lokale Server

| Minecraft      | Schutz                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| vor 1.7        | kein Log4j 2, nichts nötig (JVM-Option schadet nicht)                     |
| 1.7–1.11.2     | JVM-Option + `-Dlog4j.configurationFile=…/log4j2_17-111.xml`              |
| 1.12–1.16.5    | JVM-Option + `-Dlog4j.configurationFile=…/log4j2_112-116.xml`             |
| 1.17–1.18.0    | JVM-Option `-Dlog4j2.formatMsgNoLookups=true`                             |
| ab 1.18.1      | behoben, JVM-Option wird trotzdem gesetzt                                 |

Gilt für alle Plattformen (Vanilla, Fabric, Quilt, Forge, NeoForge, Paper, Purpur, Folia), entscheidend ist
`mc_version` des Servers. Setzt der Nutzer in den JVM-Argumenten selbst `-Dlog4j.configurationFile`, bleibt seine
Konfiguration, und der Launcher ergänzt nur die JVM-Option. Das Server-Log zeigt „Log4Shell-Schutz aktiv (…)“.

Hinweis: Mojangs Konfiguration ersetzt die eigene Log-Konfiguration von Forge/Paper. Damit fehlen z. B. Forges
`debug.log` und Papers farbige Konsole. Das Konsolenformat ist dann das von Vanilla, und das versteht der Log-Parser.

### Dateien (Mojangs Sicherheitshinweis, Dezember 2021)

- `https://launcher.mojang.com/v1/objects/4bb89a97a66f350bc9f73b3ca8509632682aea2e/log4j2_17-111.xml`
  (SHA1 `4bb89a97a66f350bc9f73b3ca8509632682aea2e`, 1219 Bytes)
- `https://launcher.mojang.com/v1/objects/02937d122c86ce73319ef9975b58896fc1b491d1/log4j2_112-116.xml`
  (SHA1 `02937d122c86ce73319ef9975b58896fc1b491d1`, 1131 Bytes)

Beide wurden am 21.11.2026 geladen und geprüft. Der Launcher lädt sie mit SHA1-Prüfung nach
`<Datenordner>/meta/assets/log_configs/`, also in denselben Ordner wie die Client-Log-Konfigurationen. Schlägt der
Download fehl (offline), nimmt er die identische mitgelieferte Kopie (`src-tauri/src/minecraft/log4shell/*.xml`,
`.gitattributes` = binary). Ein Test prüft deren Hash.

Unterschied: `112-116` nutzt `%msg{nolookups}`. `17-111` verwirft per `RegexFilter` jede Logzeile mit `${…}`.
Auf 1.7–1.11-Servern erscheinen Angriffszeilen deshalb gar nicht erst im Log, und die Erkennung unten sieht sie nicht.

## Erkennung von Angriffsversuchen

Jede Ausgabezeile von Spiel und Server wird geprüft (`Watch::check` in den Lese-Schleifen von
`minecraft/process.rs` und `server/run.rs`). Enthält sie `${jndi:`, auch in Groß-/Kleinschreibung oder verschleiert
(`${${lower:j}ndi:…}`, `${::-n}` …), erscheint im Launcher-Log eine Warnung
„⚠ Möglicher Log4Shell-Angriffsversuch von Spieler „Name“ (Ziel: ldap://…) …“. Zusätzlich schreibt der Launcher sie
per `tracing::warn!` in seine eigene Logdatei. Blockiert wird nichts.

- Der Spielername kommt aus `<Name>` (Chat) oder aus „Name (/IP) lost connection“ bzw. „issued server command“.
- Das Ziel wird entschärft (ohne `${`), damit die Warnung selbst keinen Lookup enthält.
- Pro Lesestrom werden höchstens 10 Versuche einzeln gemeldet (Schutz vor Log-Flut).

Nicht umgesetzt: eine eigene Diagnose in der Crash-Analyse (`platform/crash`, hätte neue Frontend-Texte gebraucht).
