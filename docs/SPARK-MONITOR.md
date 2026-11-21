# spark und Ressourcenmonitor

Unter **Instanz → Inhalte → Werkzeuge → Leistung mit spark messen** wählt der Launcher die passende Modrinth-Version für Minecraft und den Loader. Die Installation nutzt den bestehenden Inhalts-Installer für Pflichtabhängigkeiten und die eingestellte Sicherung vor Mod-Änderungen.

Starte Minecraft und gib im Chat `/sparkc profiler start` ein. Spiele kurz weiter und beende die Messung mit `/sparkc profiler stop`. spark lädt das Ergebnis zu seinem eigenen Dienst hoch. Den Bericht kannst du über den Link im Spielchat oder über **spark-Bericht öffnen** bei der betreffenden Sitzung öffnen. Dabei erkennt der Launcher URLs des offiziellen spark-Viewers im Sitzungslog. [spark-Befehle](https://spark.lucko.me/docs/Command-Usage)

Der Ressourcenmonitor öffnet sich über das Aktivitätssymbol neben den laufenden Spielen. Er zeigt jede Run-ID einzeln, auch wenn dieselbe Instanz mehrfach läuft. RAM ist der vom Prozess belegte Arbeitsspeicher. Bei CPU entsprechen 100 % einem voll ausgelasteten logischen Kern. Die Oberfläche fragt die Werte alle drei Sekunden ab, solange der Dialog im sichtbaren Fenster offen ist. Die erste Messung liefert zunächst RAM. CPU braucht zwei Stichproben.

Für eine Mock-Sitzung lässt sich `vl.mock.sessions` etwa auf `survival,survival:1` setzen. `vl.mock.spark.report` kann eine URL des offiziellen spark-Viewers für die Anzeige des Linkknopfs enthalten.
