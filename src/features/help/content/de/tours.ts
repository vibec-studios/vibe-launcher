import type { HelpContent } from "../../types";

export const tours: HelpContent["tours"] = {
  intro: {
    title: "Kurze Einführung",
    steps: [
      {
        title: "Hier startest du dein Spiel",
        text: "Ein Klick auf „Spielen“ startet dein zuletzt gespieltes Spiel. Alles Nötige lädt der Launcher selbst.",
        variants: {
          "new-game": { title: "Neues Spiel erstellen", text: "Wähle einfach, was du vorhast. Version und Einrichtung übernimmt der Launcher." },
          "new-instance": { title: "Neues Spiel erstellen", text: "Wähle einfach, was du vorhast. Version und Einrichtung übernimmt der Launcher." },
        },
      },
      { title: "Meine Spiele", text: "Alle deine Spiele auf einen Blick. Dort fügst du Mods hinzu, siehst deine Welten oder behebst Probleme." },
      { title: "Entdecken", text: "Mods, Texturpakete, Shader und Modpacks finden. Sie landen direkt im gewählten Spiel." },
      { title: "Dein Konto", text: "Hier wechselst du Konten und Skins und schaltest jederzeit in den Experten-Modus." },
      { title: "Hilfe & Anleitungen", text: "Hier findest du jederzeit Schritt-für-Schritt-Anleitungen und weitere Touren." },
    ],
  },
  "first-instance": {
    title: "Erste Instanz",
    steps: [
      { title: "Neue Instanz", text: "Über dieses Plus legst du jederzeit eine neue Instanz an, egal auf welcher Seite du bist." },
      { title: "Oder direkt in der Bibliothek", text: "Hier geht es auch. Danach wählst du Version und Loader, den Rest lädt der Launcher." },
      { title: "Schon einen anderen Launcher?", text: "Mit „Importieren“ übernimmst du deine bestehenden Instanzen mit Welten und Einstellungen." },
      { title: "Deine Bibliothek", text: "Alle Instanzen findest du hier. Klick auf eine Instanz, um Mods, Welten und Einstellungen zu sehen." },
    ],
  },
  modpack: {
    title: "Modpack installieren",
    steps: [
      { title: "Entdecken", text: "Hier findest du Mods und Modpacks von Modrinth und CurseForge." },
      { title: "Typ wählen", text: "„Modpacks“ ist schon ausgewählt. Hier wechselst du auch zu Mods, Shadern oder Texturpaketen." },
      { title: "Suchen", text: "Gib den Namen des Modpacks ein. Links kannst du nach Version, Loader und Kategorie filtern." },
      { title: "Installieren", text: "Öffne ein Modpack und klicke auf „Installieren“. Es entsteht eine neue Instanz mit allem Drum und Dran." },
    ],
  },
  mods: {
    title: "Mods verwalten",
    steps: [
      { title: "Inhalte hinzufügen", text: "Öffnet „Entdecken“, schon passend gefiltert auf die Version und den Loader dieser Instanz." },
      { title: "Eigene Dateien", text: "Hast du eine .jar-Datei? Füge sie hier hinzu oder ziehe sie einfach ins Fenster." },
      {
        title: "Updates",
        text: "Es gibt Updates. Ein Klick aktualisiert alle Mods auf einmal.",
        variants: { "content-refresh": { title: "Nach Updates suchen", text: "„Neu prüfen“ (oder F5) sucht nach Updates und Problemen. Gibt es welche, erscheint daneben „Alle aktualisieren“." } },
      },
      { title: "Deine Inhalte", text: "Mit dem Schalter in jeder Zeile schaltest du einen Mod aus, ohne ihn zu löschen." },
    ],
  },
  import: {
    title: "Import",
    steps: [
      { title: "Importieren", text: "Hier übernimmst du Modpack-Dateien oder ganze Instanzen aus anderen Launchern." },
      { title: "Datei oder Launcher", text: "„Aus anderem Launcher“ sucht automatisch nach Modrinth App, CurseForge, Prism, MultiMC und weiteren." },
      { title: "Auswählen", text: "Hake die Instanzen an und klicke auf „Importieren“. Fehlt dein Launcher, wähle seinen Ordner selbst." },
      { title: "Nachimportieren", text: "Neue Instanzen im alten Launcher? Öffne den Import einfach wieder. Schon übernommene sind markiert." },
    ],
  },
  autofix: {
    title: "Autofix",
    steps: [
      {
        title: "Probleme beheben",
        text: "Ein Klick und der Launcher sucht die Ursache, zeigt seine Vorschläge und legt vorher eine Sicherung an.",
        variants: {
          "crash-banner": { title: "Absturz erkannt", text: "Nach einem Absturz erscheint hier dieser Hinweis mit der wahrscheinlichsten Ursache. „Beheben“ repariert das Spiel automatisch." },
          "logs-diagnose": { title: "Diagnose", text: "Nach einem Absturz erscheint oben ein roter Hinweis mit „Beheben“. Hier in der Diagnose siehst du Details und startest ebenfalls „Probleme beheben“." },
        },
      },
      { title: "Neu starten", text: "Danach einfach wieder auf „Spielen“. Der Launcher prüft vor dem Start erneut." },
      { title: "Hilft nichts?", text: "Dann schick uns über Feedback einen Fehlerbericht. Logs hängen wir auf Wunsch an." },
    ],
  },
  backups: {
    title: "Backups",
    steps: [
      { title: "Snapshot erstellen", text: "Sichert Mods, Configs und Packs dieser Instanz, z. B. vor einem großen Update. Welten sicherst du im Bereich „Welten“." },
      { title: "Deine Sicherungen", text: "Hier stehen Snapshots und Welt-Backups. Mit „Wiederherstellen“ gehst du zurück." },
      { title: "Automatisch sichern", text: "In den Einstellungen legst du fest, wann der Launcher selbst sichert und wie viele Backups er behält." },
    ],
  },
  hosting: {
    title: "Mit Freunden spielen",
    steps: [
      { title: "Deine Welten", text: "Hier liegen deine Welten. Für Freunde machst du unter „Server“ einen eigenen Server daraus, mit dem Vibe Relay als Verbindung." },
      { title: "Play-Link", text: "Solange du hostest, steht hier dein Play-Link. Kopiere ihn oder schick ihn direkt an Freunde." },
      { title: "Freunde", text: "Hier siehst du, wer online ist, und lädst Freunde direkt in deine Welt ein." },
      { title: "Eigener Server", text: "Soll die Welt auch ohne dich laufen? Lege einen Server an und wähle als Verbindung „Vibe Relay“." },
    ],
  },
  servers: {
    title: "Server",
    steps: [
      { title: "Neuer Server", text: "Wähle Plattform und Version. Der Launcher lädt den Server herunter und richtet ihn ein." },
      { title: "Deine Server", text: "Öffne einen Server für Konsole, Spieler, Welten, Add-ons und die Verbindung für Freunde." },
      { title: "Immer erreichbar", text: "Hier findest du deine Server jederzeit wieder. Ein grüner Punkt zeigt, dass einer läuft." },
    ],
  },
  skins: {
    title: "Skins",
    steps: [
      { title: "Vorschau", text: "So sieht dein Skin gerade aus. Ziehe die Figur, um sie zu drehen." },
      { title: "Deine Skins", text: "Lade neue Skins hoch oder wähle einen gespeicherten aus und übernimm ihn." },
    ],
  },
  modsets: {
    title: "Mod-Sets",
    steps: [
      { title: "Neues Set", text: "Lege eine Liste deiner Lieblings-Mods an. Sie gilt für jede Version." },
      { title: "Importieren", text: "Sets von Freunden oder aus einer Datei übernimmst du hier." },
      { title: "Deine Sets", text: "Öffne ein Set, um Mods hinzuzufügen oder es auf eine Instanz anzuwenden." },
    ],
  },
  gallery: {
    title: "Galerie",
    steps: [
      { title: "Nach Instanz filtern", text: "Zeige nur Bilder aus einer bestimmten Instanz." },
      { title: "Ansehen", text: "Klicke auf ein Bild, um es groß zu öffnen, zu kopieren oder im Ordner zu zeigen." },
    ],
  },
  waitlist: {
    title: "Vibe-Beta",
    steps: [
      { title: "Vibe & Konto", text: "Hier meldest du dich bei Vibe an. Vibe ist in der Beta, du trittst zuerst einer Warteliste bei." },
      { title: "Dein Zugang", text: "Hier siehst du deinen Status. Nach der Freischaltung funktionieren Freunde, Chat und Hosting." },
    ],
  },
  feedback: {
    title: "Feedback",
    steps: [
      { title: "Feedback senden", text: "Fehler oder Idee? Hier schreibst du uns. Logs und ein Screenshot lassen sich anhängen." },
      { title: "Hilfe", text: "Und hier findest du alle Anleitungen und Touren, falls du nicht weiterweißt." },
    ],
  },
  performance: {
    title: "Leistung & RAM",
    steps: [
      { title: "Instanz-Einstellungen", text: "Über das Zahnrad öffnest du die Einstellungen dieser Instanz." },
      { title: "Leistung dieser Instanz", text: "Hier legst du fest, wie viel Arbeitsspeicher diese Instanz bekommt. Mit „Eigene Werte“ überschreibst du die Standardwerte." },
      { title: "Arbeitsspeicher für alle", text: "Diese Werte gelten für alle Instanzen ohne eigene Einstellung. Mit Mods sind 4–6 GB ein guter Start." },
    ],
  },
  privacy: {
    title: "Datenschutz",
    steps: [
      { title: "Datenschutz", text: "Hier findest du alles dazu, was der Launcher sendet, und schaltest es ab." },
      { title: "Was wohin geht", text: "Jeder Dienst mit dem, was er bekommt, und wann. Ganz oben steht unser Versprechen." },
    ],
  },
};
