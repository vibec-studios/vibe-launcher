import type { HelpContent } from "../../types";

export const guides: HelpContent["guides"] = {
  "first-instance": {
    title: "Erste Instanz erstellen",
    summary: "Eine Instanz ist ein eigenes Minecraft mit eigener Version, eigenen Mods und eigenen Welten. Du kannst beliebig viele davon haben.",
    steps: [
      "Klicke links in der Seitenleiste auf „+ Neue Instanz“ oder auf der Startseite auf „Neue Instanz“.",
      "Wähle aus, was du vorhast: Vanilla, mit Mods, ein Modpack oder einen Import. Im Simple-Modus reicht ein Klick auf ein Ziel.",
      "Gib der Instanz einen Namen und wähle die Minecraft-Version. Für Mods wählst du zusätzlich einen Loader (Fabric, NeoForge, Forge oder Quilt).",
      "Klicke auf „Erstellen“. Der Launcher lädt Minecraft, Java und den Loader selbst herunter. Den Fortschritt siehst du oben rechts bei den Aufgaben.",
      "Sobald die Instanz fertig ist, startest du sie mit „Spielen“.",
    ],
    tips: [
      "Melde dich vorher mit deinem Microsoft-Konto an (Konto-Knopf oben rechts), sonst kannst du nicht online spielen.",
      "Du weißt nicht, welchen Loader du brauchst? Nimm Fabric. Die meisten aktuellen Mods gibt es dafür.",
    ],
    keywords: "neu anlegen version loader fabric forge vanilla spiel",
  },
  modpack: {
    title: "Modpack installieren",
    summary: "Ein Modpack ist eine fertige Sammlung von Mods. Der Launcher legt dafür eine neue Instanz an und installiert alles automatisch.",
    steps: [
      "Öffne „Entdecken“ in der Seitenleiste.",
      "Wähle oben den Typ „Modpacks“.",
      "Suche nach dem Namen des Modpacks oder stöbere über die Filter links.",
      "Öffne das Modpack und klicke auf „Installieren“. Es entsteht eine neue Instanz mit dem Namen des Modpacks.",
      "Warte, bis die Installation fertig ist (oben rechts bei den Aufgaben), und klicke dann auf „Spielen“.",
    ],
    tips: [
      "Modpack-Dateien (.mrpack, .zip von CurseForge) kannst du auch einfach ins Launcher-Fenster ziehen.",
      "Gibt es ein Update, zeigt die Instanz einen Hinweis. Deine Welten bleiben beim Update erhalten.",
    ],
    keywords: "modrinth curseforge mrpack pack sammlung",
  },
  mods: {
    title: "Mods hinzufügen und aktualisieren",
    summary: "Mods, Texturpakete und Shader fügst du direkt in einer Instanz hinzu. Updates prüft der Launcher für dich.",
    steps: [
      "Öffne die Instanz in der Bibliothek und bleibe im Bereich „Inhalte“.",
      "Klicke auf „Inhalte hinzufügen“. Es öffnet sich „Entdecken“, gefiltert auf passende Version und Loader.",
      "Klicke bei einem Mod auf „Installieren“. Benötigte Abhängigkeiten lädt der Launcher mit.",
      "Eigene .jar-Dateien fügst du über „Dateien hinzufügen“ hinzu oder ziehst sie ins Fenster.",
      "Mit „Neu prüfen“ (oder F5) sucht der Launcher nach Updates. Gibt es welche, aktualisierst du sie mit „Alle aktualisieren“.",
    ],
    tips: [
      "Einzelne Mods kannst du mit dem Schalter in der Liste ausschalten, ohne sie zu löschen.",
      "Vor großen Updates lohnt sich ein Backup der Instanz.",
    ],
    keywords: "mod jar update aktualisieren shader texturpaket resourcepack hinzufügen",
  },
  import: {
    title: "Aus anderem Launcher importieren",
    summary: "Du kannst Instanzen aus anderen Launchern übernehmen, z. B. Modrinth App, CurseForge, Prism, MultiMC, ATLauncher, GDLauncher oder dem offiziellen Launcher.",
    steps: [
      "Klicke in der Bibliothek oder auf der Startseite auf „Importieren“.",
      "Wähle oben „Aus anderem Launcher“. Der Launcher sucht selbst nach installierten Launchern.",
      "Wird dein Launcher nicht gefunden, klicke auf „Ordner wählen …“ und wähle seinen Ordner oder den einer einzelnen Instanz.",
      "Hake die Instanzen an, die du übernehmen möchtest, und klicke auf „Importieren“. Welten, Configs und Einstellungen kommen mit.",
      "Nachimportieren: Öffne den Import später einfach erneut. Schon übernommene Instanzen sind als „Bereits importiert“ markiert, neue kannst du dazunehmen.",
    ],
    tips: [
      "Dein alter Launcher bleibt unverändert, es wird nur kopiert.",
      "Einzelne Modpack-Dateien importierst du im Modus „Datei“.",
      "Nach dem Import bietet der Launcher an, Einstellungen wie RAM oder Java mitzunehmen.",
    ],
    keywords: "import übernehmen prism multimc curseforge modrinth atlauncher gdlauncher nachimport erneut",
  },
  autofix: {
    title: "Autofix nach einem Absturz",
    summary: "Stürzt Minecraft ab, sucht der Launcher die Ursache und schlägt eine Lösung vor, z. B. fehlende Abhängigkeiten, falsches Java oder zu wenig RAM.",
    steps: [
      "Nach einem Absturz erscheint oben in der Instanz ein roter Hinweis „Absturz erkannt“.",
      "Klicke auf „Beheben“ bzw. „Probleme beheben“. Der Launcher zeigt, was er gefunden hat und was er ändern würde.",
      "Bestätige die Vorschläge. Vorher legt der Launcher automatisch eine Sicherung an.",
      "Starte das Spiel erneut. Hilft es nicht, öffne im Experten-Modus unter „Logs“ die „Diagnose“ für Details.",
      "Klappt es immer noch nicht, schicke über „Problem melden“ einen Fehlerbericht mit Logs.",
    ],
    tips: [
      "Häufigste Ursache: ein Mod passt nicht zur Minecraft-Version oder eine Abhängigkeit fehlt.",
      "Autofix kannst du jederzeit rückgängig machen: Die Sicherung findest du unter „Backups“.",
    ],
    keywords: "absturz crash fehler reparieren beheben diagnose logs startet nicht",
  },
  backups: {
    title: "Backups",
    summary: "Backups sichern Welten oder ganze Instanzen. So kannst du nach einem kaputten Update oder einem Fehler zurück.",
    steps: [
      "Öffne die Instanz und wechsle in den Bereich „Backups“.",
      "„Snapshot erstellen“ sichert Mods, Configs, Packs und Optionen, aber keine Welten. Ideal vor einem Update.",
      "Welten sicherst du im Bereich „Welten“: Rechtsklick auf die Welt → „Backup erstellen“. Sie erscheinen unter „Welt-Backups“.",
      "Zum Zurückspielen klickst du beim Snapshot bzw. Backup auf „Wiederherstellen“.",
      "Automatische Backups stellst du unter Einstellungen → Spiel → Backups ein, z. B. vor jedem Start.",
    ],
    tips: [
      "Automatische Backups zählen zur Aufbewahrungsgrenze, alte werden dann gelöscht.",
      "Autofix legt vor jeder Änderung selbst einen Snapshot an.",
    ],
    keywords: "sicherung backup wiederherstellen welt zurück",
  },
  hosting: {
    title: "Mit Freunden spielen",
    summary: "Mit einem eigenen Server und dem Vibe Relay spielen Freunde ohne Portfreigabe mit dir. Bekommst du einen Play-Link, richtet der Launcher das passende Modpack ein.",
    steps: [
      "Öffne „Server“ in der Seitenleiste und klicke auf „Neuer Server“. Eine Einzelspielerwelt kannst du dabei als Serverwelt übernehmen.",
      "Wähle als Verbindung „Vibe Relay“. Dann klappt es ohne Portfreigabe.",
      "Starte den Server und lade Freunde über „Freunde“ direkt ein.",
      "Hat dir jemand einen Play-Link geschickt, öffne ihn einfach. Der Launcher richtet das passende Modpack ein und verbindet dich.",
    ],
    tips: ["Hosting braucht Vibe (Einstellungen → Vibe & Konto). Vibe ist gerade in der Beta, siehe „Vibe-Beta-Warteliste“."],
    keywords: "freunde multiplayer relay einladen link play-link teilen lan hosten",
  },
  servers: {
    title: "Server verwalten",
    summary: "Du kannst eigene Minecraft-Server auf deinem PC anlegen, starten und verwalten, mit Konsole, Spielern, Welten und Add-ons.",
    steps: [
      "Öffne „Server“ in der Seitenleiste (im Experten-Modus).",
      "Klicke auf „Neuer Server“ und wähle Plattform (z. B. Paper, Fabric, NeoForge) und Version.",
      "Starte den Server. In der Konsole siehst du, was passiert, und kannst Befehle eingeben.",
      "Unter „Verbindung“ legst du fest, wie Freunde beitreten: lokal/LAN, Vibe Relay oder playit.gg.",
      "Unter „Spieler“ verwaltest du Whitelist, Operatoren und Banns, unter „Add-ons“ Plugins und Mods.",
    ],
    tips: ["Der Server läuft auf deinem PC. Er ist nur erreichbar, solange der PC an ist."],
    keywords: "server paper spigot konsole whitelist plugin verbindung",
  },
  skins: {
    title: "Skins",
    summary: "Skins änderst du direkt im Launcher, mit 3D-Vorschau und eigener Skin-Bibliothek.",
    steps: [
      "Öffne „Skins“ in der Seitenleiste oder über den Konto-Knopf oben rechts.",
      "Lade einen Skin hoch oder wähle einen aus deiner Bibliothek. Die 3D-Vorschau zeigt, wie er aussieht.",
      "Wähle zwischen klassischem und schmalem Modell und klicke auf „Übernehmen“.",
    ],
    tips: ["Zum Ändern des Skins musst du mit deinem Microsoft-Konto angemeldet sein."],
    keywords: "skin umhang cape aussehen",
  },
  modsets: {
    title: "Mod-Sets",
    summary: "Ein Mod-Set ist eine Liste deiner Lieblings-Mods. Du kannst es auf jede Instanz anwenden, auch auf andere Versionen.",
    steps: [
      "Öffne „Bibliothek“ und dort oben „Mod-Sets“.",
      "Klicke auf „Neues Set“ oder übernimm die Mods einer bestehenden Instanz.",
      "Füge Mods hinzu, über die Suche oder per eingefügter Liste.",
      "Wende das Set über „Anwenden“ auf eine Instanz an. Der Launcher sucht passende Versionen für die jeweilige Minecraft-Version.",
    ],
    tips: ["Sets lassen sich exportieren und importieren, ideal zum Teilen mit Freunden."],
    keywords: "set liste sammlung lieblings mods anwenden",
  },
  gallery: {
    title: "Galerie",
    summary: "In der Galerie findest du alle Screenshots aus deinen Instanzen an einem Ort.",
    steps: [
      "Öffne „Galerie“ in der Seitenleiste.",
      "Filtere nach Instanz, um nur Bilder aus einem Spiel zu sehen.",
      "Klicke auf ein Bild, um es groß anzusehen, zu kopieren oder den Ordner zu öffnen.",
    ],
    tips: ["Screenshots machst du im Spiel mit F2."],
    keywords: "screenshot bild galerie aufnahme",
  },
  waitlist: {
    title: "Vibe-Beta-Warteliste",
    summary: "Vibe (Freunde, Chat, Hosting) ist in der Beta. Zum Mitmachen trittst du einer Warteliste bei, das Team schaltet dich frei.",
    steps: [
      "Öffne Einstellungen → Vibe & Konto.",
      "Melde dich mit deinem Minecraft-Konto bei Vibe an.",
      "Tritt der Warteliste bei. Dein Status steht danach in diesem Bereich.",
      "Sobald das Team dich freischaltet, funktionieren Freunde, Chat und Hosting.",
    ],
    tips: [
      "Der Launcher selbst funktioniert auch ohne Vibe voll: Instanzen, Mods, Modpacks und Server.",
      "Wer schon vor der Beta dabei war, ist automatisch freigeschaltet.",
    ],
    keywords: "beta warteliste freischalten zugang vibe konto anmelden",
  },
  bedrock: {
    title: "Bedrock (experimentell)",
    summary: "Neben Java kann der Launcher auch Minecraft Bedrock starten und Add-ons, Welten und Sicherungen verwalten. Die Funktion ist noch experimentell.",
    steps: [
      "Installiere Minecraft Bedrock vorher über den Microsoft Store oder die Xbox-App.",
      "Klicke auf „Neue Instanz“ und wähle den Reiter „Bedrock“.",
      "Wähle Release oder Preview und ob die Instanz eigene Spieldaten bekommen soll.",
      "In der Bedrock-Instanz verwaltest du Add-ons, Welten und Sicherungen. Mit „Spielen“ startest du das installierte Spiel.",
    ],
    tips: [
      "Bedrock-Instanzen erkennst du am Kürzel „BE“.",
      "Versionswahl, Java-Mods und Play-Links gibt es für Bedrock nicht.",
    ],
    keywords: "bedrock windows edition xbox addon store experimentell",
  },
  feedback: {
    title: "Feedback senden",
    summary: "Etwas funktioniert nicht oder du hast eine Idee? Schick es direkt aus dem Launcher an das Team.",
    steps: [
      "Klicke oben rechts auf das Feedback-Symbol (Sprechblase mit Ausrufezeichen).",
      "Wähle, ob es ein Fehler, eine Idee oder etwas anderes ist, und beschreibe es kurz.",
      "Bei Fehlern kannst du Logs und einen Screenshot anhängen. Das hilft beim Finden der Ursache.",
      "Klicke auf „Senden“. Du bekommst eine Ticket-Nummer. Gib sie an, wenn du uns dazu auf Discord schreibst.",
    ],
    tips: ["Nach einem Absturz gibt es den Knopf „Problem melden“, der die passenden Logs schon mitnimmt."],
    keywords: "feedback fehler bug melden idee vorschlag support ticket",
  },
  performance: {
    title: "Leistung und RAM einstellen",
    summary: "Wie viel Arbeitsspeicher (RAM) Minecraft bekommt, stellst du für alle Instanzen oder für eine einzelne Instanz ein.",
    steps: [
      "Für alle Instanzen: Einstellungen → Java & Speicher (im einfachen Modus: Arbeitsspeicher).",
      "Für eine Instanz: Instanz öffnen → Zahnrad (Instanz-Einstellungen) → Java → „Eigene Werte“.",
      "Faustregel: Vanilla 2–4 GB, mit Mods 4–6 GB, große Modpacks 6–8 GB.",
      "Gib nie mehr als etwa drei Viertel deines RAMs. Windows und andere Programme brauchen auch Speicher.",
      "Ruckelt es trotzdem, helfen Leistungs-Mods wie Sodium. Der Launcher schlägt sie im Bereich „Inhalte“ vor.",
    ],
    tips: [
      "Im Simple-Modus wählst du die Leistungsstufe in den Instanz-Einstellungen statt genauer Zahlen.",
      "Zu viel RAM kann das Spiel sogar langsamer machen.",
    ],
    keywords: "ram speicher arbeitsspeicher leistung fps ruckeln langsam java memory",
  },
  privacy: {
    title: "Datenschutz & Transparenz",
    summary: "Der Vibe Launcher zeigt keine Werbung und sammelt keine Telemetrie. Hier steht, was er wann wohin sendet und wie du es abschaltest.",
    steps: [
      "Öffne Einstellungen → Datenschutz. Ganz oben steht unser Versprechen: keine Werbung, keine Telemetrie, Vibe nur mit deiner Zustimmung.",
      "Unter „Deine Schalter“ stellst du Update-Suche, Discord-Status, MinecraftCapes und deinen Online-Status ein.",
      "„Was wird wohin gesendet“ listet jeden Dienst mit dem, was er bekommt, und wann das passiert.",
      "Fehlerberichte gehen nur raus, wenn du sie dir angesehen und auf „Senden“ geklickt hast. Logs werden vorher bereinigt.",
    ],
    tips: [
      "Vibe-Dienste sind bei einer neuen Installation aus. Du schaltest sie in der Einrichtung oder unter Einstellungen → Vibe & Konto ein.",
      "Deine Anmeldedaten liegen im Windows-Tresor (Anmeldeinformationsverwaltung) und nicht in Dateien.",
    ],
    keywords: "datenschutz privatsphäre telemetrie tracking werbung daten senden dsgvo transparenz privacy",
  },
  portable: {
    title: "Portabler Modus (USB-Stick)",
    summary: "Der Launcher kann ohne Installation von einem USB-Stick laufen. Alle Daten liegen dann im Ordner „VibeData“ neben der Datei.",
    steps: [
      "Öffne Einstellungen → Allgemein und klicke unter „Portabler Modus“ auf „Portable Kopie erstellen …“.",
      "Wähle einen Ordner auf deinem USB-Stick. Der Launcher kopiert sich dorthin und legt die Datei „portable.txt“ daneben.",
      "Starte am anderen PC „vibe-launcher.exe“ vom Stick. Melde dich dort einmal mit Microsoft an.",
      "Auf fremden PCs schaltest du „Beim Schließen von diesem PC abmelden“ ein. Dann bleiben dort keine Anmeldedaten zurück.",
    ],
    tips: [
      "Anmeldedaten stehen nie auf dem Stick. Verlierst du ihn, kann niemand damit in dein Konto.",
      "Der portable Launcher aktualisiert sich nicht selbst. Erstelle die portable Kopie mit dem neuen Launcher einfach noch einmal in denselben Ordner, deine Daten bleiben erhalten.",
      "Ohne Knopf geht es auch: vibe-launcher.exe in einen Ordner kopieren und daneben eine leere Datei „portable.txt“ anlegen.",
    ],
    keywords: "portabel portable usb stick ohne installation mitnehmen schule anderer pc",
  },
};
