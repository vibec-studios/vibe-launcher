# Regelbasierte Absturzhilfe

Die Absturzdiagnose prüft lokale Logs und Crash-Reports. Sie erkennt jetzt zusätzlich diese Fehlerbilder und zeigt für Treffer die Logfundstelle.

| Meldung | Handlungsschritt |
| --- | --- |
| Laufwerk voll oder Speicherquote erreicht | Platz auf dem betroffenen Laufwerk schaffen. |
| Java lehnt eine Startoption ab | Die gemeldete Option mit den eigenen Java-Argumenten vergleichen. |
| Java kann keinen Puffer oder Hintergrund-Thread anlegen | Andere Programme schließen und eigene Java-Speicheroptionen prüfen. |
| ZIP oder JAR beschädigt | Die genannte Datei im Log suchen und die Mod oder das Paket erneut herunterladen. |
| Eine Welt ist bereits geöffnet | Die Welt in der anderen Sitzung schließen. |

Auch **Probleme beheben** zeigt die passenden manuellen Schritte. Die Auswertung läuft lokal mit Regeln und benötigt keinen KI-Dienst.

Im Mock-Modus zeigt `vl.mock.crash = "survival"` zusammen mit `vl.mock.crash.rule = "disk_full"` das Beispiel mit vollem Laufwerk.
