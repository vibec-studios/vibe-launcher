export const usage = `Launcher-Vergleich (bench/compare)

  node bench/compare/run.mjs --phase <phase>[,<phase>…] [Optionen]

Phasen:
  setup     Launcher, Java und Modpack in den Testordner laden (feste Versionen, Prüfsummen)
  idle      Start bis bedienbar, RAM nach 30 s und 5 min, CPU im Leerlauf
  install   Vanilla-Instanz und .mrpack-Import anlegen, Zeit und Plattenplatz
  launch    Spielstart bis Hauptmenü (kalt/warm); fragt einmal nach Microsoft-Anmeldung
  attach    beliebige EXE nur auf Start/RAM messen (--exe, --name), z. B. in einer Sandbox
  report    HTML-Bericht aus results/*.json neu bauen
  cleanup   eigene Testprozesse beenden und Testordner löschen

Optionen:
  --launchers vibe,prism[,atlauncher]   Auswahl (Standard: vibe,prism)
  --runs N                              Durchläufe (idle 5, install 3, launch 3)
  --long-runs N                         idle: Läufe mit langem Leerlauf (Standard 2)
  --idle-seconds S                      idle: Dauer des langen Leerlaufs (Standard 300)
  --kinds vanilla,pack                  launch: welche Instanzen
  --work <Ordner>                       Testordner (Standard %LOCALAPPDATA%\\vibe-launcher-bench)
  --prism-downloads N                   Prism: parallele Downloads (Standard 6, Vibe nutzt 16)
  --keep                                install: Datenordner nicht löschen
  --keep-downloads                      cleanup: Downloads behalten
`;
