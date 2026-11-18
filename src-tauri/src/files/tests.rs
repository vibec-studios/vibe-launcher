use super::ops::*;
use super::sandbox::*;
use super::*;
use std::path::Path;

struct Tmp {
    base: std::path::PathBuf,
    r: FileRoot,
}

impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

fn tmp(tag: &str) -> Tmp {
    let base = std::env::temp_dir().join(format!("vl-files-{tag}-{}", uuid::Uuid::new_v4()));
    let game = base.join("minecraft");
    std::fs::create_dir_all(game.join("config/sub")).unwrap();
    std::fs::create_dir_all(game.join("saves/Welt")).unwrap();
    std::fs::create_dir_all(game.join("logs")).unwrap();
    std::fs::create_dir_all(base.join("outside")).unwrap();
    std::fs::write(base.join("outside/secret.txt"), "geheim").unwrap();
    let r = FileRoot::custom(game, base.join("backups"), &["vibe-server.json", ".vibe-pid"]);
    Tmp { base, r }
}

fn game(t: &Tmp) -> &Path {
    &t.r.sandbox.root
}

/// Verzeichnis-Link anlegen: Symlink (Unix) bzw. Junction (Windows, klappt ohne Adminrechte).
fn dir_link(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    {
        // mklink versteht nur Backslashes
        let link = std::path::PathBuf::from(link.to_string_lossy().replace('/', "\\"));
        let target = std::path::PathBuf::from(target.to_string_lossy().replace('/', "\\"));
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

fn file_link(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(target, link).is_ok()
    }
}

#[test]
fn normalize_rejects_bad_paths() {
    for bad in [
        "../x.json",
        "config/../../x.json",
        "config/..",
        "/config/a.json",
        "\\config\\a.json",
        "\\\\server\\share\\x",
        "C:/Windows/win.ini",
        "C:config/a.json",
        "config/a.json:stream",
        "config/a\0.json",
        "config/a\u{1}.json",
    ] {
        assert!(normalize(bad).is_err(), "sollte abgelehnt werden: {bad:?}");
    }
    #[cfg(windows)]
    for bad in ["config/...", "config/a.json.", "config/a.json ", "con", "config/NUL.txt", "lpt1.json"] {
        assert!(normalize(bad).is_err(), "sollte abgelehnt werden: {bad:?}");
    }
    assert_eq!(normalize("config/sub/a.json").unwrap(), vec!["config", "sub", "a.json"]);
    assert_eq!(normalize("config\\a.toml").unwrap(), vec!["config", "a.toml"]);
    assert_eq!(normalize("./config//a.toml").unwrap(), vec!["config", "a.toml"]);
    assert!(normalize("").unwrap().is_empty());
    assert!(normalize("options.txt").is_ok());
    // Punkte mitten im Namen sind erlaubt
    assert!(normalize("config/..hidden/a..b.json").is_ok());
}

#[test]
fn names_are_checked() {
    for bad in ["", ".", "..", "a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b", "x.", "x ", "CON", "nul.txt", "Com1.json", "a\tb"] {
        assert!(check_name(bad).is_err(), "Name sollte abgelehnt werden: {bad:?}");
    }
    for ok in ["a.json", ".gitignore", "Neue Datei.txt", "console.txt", "über.toml"] {
        assert!(check_name(ok).is_ok(), "Name sollte erlaubt sein: {ok:?}");
    }
}

#[test]
fn resolve_stays_inside() {
    let t = tmp("resolve");
    std::fs::write(game(&t).join("config/a.json"), "{}").unwrap();
    let sb = &t.r.sandbox;
    let p = sb.resolve("config\\a.json", false).unwrap();
    assert_eq!(p.rel, "config/a.json");
    assert!(p.exists && p.abs.ends_with("a.json"));
    // Wurzel nur, wenn erlaubt
    assert!(sb.resolve("", false).is_err());
    assert!(sb.resolve("", true).unwrap().is_root());
    assert!(sb.resolve(".", false).is_err());
    // Neue Datei in vorhandenem Ordner ok, in fehlendem Ordner nicht
    let n = sb.resolve("config/neu.json", false).unwrap();
    assert!(!n.exists);
    assert!(sb.resolve("config/fehlt/neu.json", false).is_err());
    // Datei als Ordner
    assert!(sb.resolve("config/a.json/x", false).is_err());
    // Ausbruch über ..
    assert!(sb.resolve("config/../../outside/secret.txt", false).is_err());
    assert!(sb.resolve("../outside/secret.txt", false).is_err());
    // Absolute Pfade (auch auf die Wurzel selbst)
    let abs = game(&t).join("config/a.json").to_string_lossy().to_string();
    assert!(sb.resolve(&abs, false).is_err());
    // Geschützte Einträge (ohne Groß-/Kleinschreibung)
    std::fs::write(game(&t).join("vibe-server.json"), "{}").unwrap();
    assert!(sb.resolve("vibe-server.json", false).is_err());
    assert!(sb.resolve("VIBE-SERVER.JSON", false).is_err());
    // In Unterordnern ist derselbe Name normal
    std::fs::write(game(&t).join("config/vibe-server.json"), "{}").unwrap();
    assert!(sb.resolve("config/vibe-server.json", false).is_ok());
}

#[test]
fn links_are_blocked() {
    let t = tmp("links");
    let outside = t.base.join("outside");
    let sb = &t.r.sandbox;
    if dir_link(&outside, &game(&t).join("config/link")) {
        assert!(sb.resolve("config/link", false).is_err());
        assert!(sb.resolve("config/link/secret.txt", false).is_err());
        assert!(sb.resolve("config/link/neu.txt", false).is_err());
        assert!(read(&t.r, "config/link/secret.txt").is_err());
        assert!(write(&t.r, "config/link/secret.txt", "x").is_err());
        assert!(create(&t.r, "config/link", "neu.txt", false).is_err());
        assert!(delete(&t.r, &["config/link".into()], true).is_err());
        assert!(rename(&t.r, "config/link", "x").is_err());
        assert!(import(&t.r, "config/link", &[]).is_err());
        // Nicht in Listen/Suche
        assert!(list_dir(&t.r, "config").unwrap().iter().all(|e| e.name != "link"));
        assert!(find(&t.r, "secret").unwrap().entries.is_empty());
        assert!(search(&t.r, "geheim", None).unwrap().hits.is_empty());
        // Das Ziel blieb unangetastet
        assert_eq!(std::fs::read_to_string(outside.join("secret.txt")).unwrap(), "geheim");
    } else {
        eprintln!("Verzeichnis-Links nicht möglich – Test übersprungen");
    }
    if file_link(&outside.join("secret.txt"), &game(&t).join("config/s.txt")) {
        assert!(read(&t.r, "config/s.txt").is_err());
        assert!(write(&t.r, "config/s.txt", "x").is_err());
        assert!(duplicate(&t.r, "config/s.txt").is_err());
        assert_eq!(std::fs::read_to_string(outside.join("secret.txt")).unwrap(), "geheim");
    }
}

#[test]
fn list_hides_internal() {
    let t = tmp("list");
    let g = game(&t);
    std::fs::write(g.join("options.txt"), "fov:0").unwrap();
    std::fs::write(g.join("vibe-server.json"), "{}").unwrap();
    std::fs::write(g.join(".vibe-pid"), "1").unwrap();
    std::fs::write(g.join("config/.a.json.vltmp"), "x").unwrap();
    std::fs::write(g.join("config/a.json"), "{}").unwrap();
    std::fs::write(g.join("icon.png"), [0x89u8, b'P', b'N', b'G']).unwrap();
    std::fs::write(g.join("servers.dat"), [0u8, 1]).unwrap();
    std::fs::write(g.join("README"), "hallo").unwrap();
    std::fs::write(g.join("blob"), [0u8, 159, 146, 150]).unwrap();
    let root = list_dir(&t.r, "").unwrap();
    let names: Vec<_> = root.iter().map(|e| e.name.as_str()).collect();
    // Ordner zuerst, dann alphabetisch
    assert_eq!(names, vec!["config", "logs", "saves", "blob", "icon.png", "options.txt", "README", "servers.dat"]);
    let kind = |n: &str| root.iter().find(|e| e.name == n).unwrap().kind;
    assert_eq!(kind("config"), "dir");
    assert_eq!(kind("icon.png"), "image");
    assert_eq!(kind("servers.dat"), "binary");
    assert_eq!(kind("README"), "text");
    assert_eq!(kind("blob"), "binary");
    assert_eq!(root.iter().find(|e| e.name == "config").unwrap().children, Some(2)); // sub + a.json (tmp zählt nicht)
    let cfg = list_dir(&t.r, "config").unwrap();
    assert!(cfg.iter().all(|e| !e.name.ends_with(TMP_SUFFIX)));
    assert_eq!(cfg.iter().find(|e| e.name == "a.json").unwrap().path, "config/a.json");
    assert!(list_dir(&t.r, "options.txt").is_err());
    assert!(list_dir(&t.r, "fehlt").is_err());
}

#[test]
fn read_kinds() {
    let t = tmp("read");
    let g = game(&t);
    std::fs::write(g.join("config/a.json"), "\u{feff}{\"a\": 1}").unwrap();
    std::fs::write(g.join("logs/latest.log"), "[main] hallo").unwrap();
    std::fs::write(g.join("crash.log"), "x").unwrap();
    std::fs::write(g.join("pack.png"), [0x89u8, b'P', b'N', b'G']).unwrap();
    std::fs::write(g.join("level.dat"), [10u8, 0, 0]).unwrap();
    std::fs::write(g.join("config/latin.properties"), b"name=M\xfcller\n").unwrap();
    std::fs::write(g.join("config/big.json"), vec![b' '; (MAX_EDIT + 1) as usize]).unwrap();
    let f = read(&t.r, "config/a.json").unwrap();
    assert_eq!((f.content.as_str(), f.language, f.readonly), ("{\"a\": 1}", "json", false));
    let f = read(&t.r, "logs/latest.log").unwrap();
    assert!(f.readonly && f.readonly_reason == Some("log") && f.content.contains("hallo"));
    assert_eq!(read(&t.r, "crash.log").unwrap().readonly_reason, Some("log"));
    let f = read(&t.r, "pack.png").unwrap();
    assert!(f.kind == "image" && f.content.is_empty());
    assert!(image_data_url(&t.r, "pack.png").unwrap().starts_with("data:image/png;base64,"));
    assert!(image_data_url(&t.r, "level.dat").is_err());
    assert_eq!(read(&t.r, "level.dat").unwrap().readonly_reason, Some("binary"));
    assert_eq!(read(&t.r, "config/latin.properties").unwrap().readonly_reason, Some("encoding"));
    let f = read(&t.r, "config/big.json").unwrap();
    assert!(f.readonly_reason == Some("too_large") && f.content.is_empty());
    assert!(read(&t.r, "config").is_err());
    // Nicht beschreibbar
    assert!(write(&t.r, "logs/latest.log", "x").is_err());
    assert!(write(&t.r, "level.dat", "x").is_err());
    assert!(write(&t.r, "config/latin.properties", "x").is_err());
    assert!(write(&t.r, "config/fehlt.json", "{}").is_err());
}

#[test]
fn write_backup_rotation_and_restore() {
    let t = tmp("backup");
    let rel = "config/sub/b.toml";
    std::fs::write(game(&t).join(rel), "v = 0\r\n").unwrap();
    for i in 1..=13 {
        let f = write(&t.r, rel, &format!("v = {i}\n")).unwrap();
        assert!(f.has_backup);
    }
    let b = list_backups(&t.r, rel);
    assert_eq!(b.len(), KEEP_BACKUPS);
    // Neueste Sicherung = Fassung vor dem letzten Schreiben; CRLF bleibt erhalten
    assert_eq!(std::fs::read_to_string(b.last().unwrap()).unwrap(), "v = 12\r\n");
    assert_eq!(std::fs::read_to_string(game(&t).join(rel)).unwrap(), "v = 13\r\n");
    // Gleicher Inhalt -> keine neue Sicherung
    write(&t.r, rel, "v = 13\n").unwrap();
    assert_eq!(list_backups(&t.r, rel).len(), KEEP_BACKUPS);
    // Wiederherstellen und rückgängig machen
    assert_eq!(restore(&t.r, rel).unwrap().content, "v = 12\r\n");
    assert_eq!(restore(&t.r, rel).unwrap().content, "v = 13\r\n");
    assert_eq!(list_backups(&t.r, rel).len(), KEEP_BACKUPS);
    // Keine Sicherung -> Fehler
    std::fs::write(game(&t).join("config/a.json"), "{}").unwrap();
    assert!(restore(&t.r, "config/a.json").is_err());
    // BOM bleibt
    std::fs::write(game(&t).join("config/bom.json"), "\u{feff}{}").unwrap();
    write(&t.r, "config/bom.json", "{\"a\": 2}").unwrap();
    assert_eq!(std::fs::read_to_string(game(&t).join("config/bom.json")).unwrap(), "\u{feff}{\"a\": 2}");
    // Sicherungen liegen außerhalb des Baums, keine tmp-Reste
    assert!(!t.r.backups.starts_with(game(&t)));
    assert!(find(&t.r, TMP_SUFFIX).unwrap().entries.is_empty());
    // Umbenennen nimmt die Sicherungen mit
    let n = rename(&t.r, rel, "c.toml").unwrap();
    assert_eq!(n, "config/sub/c.toml");
    assert!(read(&t.r, &n).unwrap().has_backup);
}

#[test]
fn create_rename_duplicate_delete() {
    let t = tmp("ops");
    let g = game(&t).to_path_buf();
    assert_eq!(create(&t.r, "config", "neu.json", false).unwrap(), "config/neu.json");
    assert!(g.join("config/neu.json").is_file());
    assert!(create(&t.r, "config", "neu.json", false).is_err(), "gibt es schon");
    assert_eq!(create(&t.r, "", "scripts", true).unwrap(), "scripts");
    assert!(g.join("scripts").is_dir());
    for bad in ["../x", "a/b", "C:x", "con", "x."] {
        assert!(create(&t.r, "config", bad, false).is_err(), "{bad}");
        assert!(rename(&t.r, "config/neu.json", bad).is_err(), "{bad}");
    }
    assert!(create(&t.r, "config/neu.json", "x", false).is_err(), "Ziel ist kein Ordner");
    assert!(create(&t.r, "", "vibe-server.json", false).is_err(), "geschützt");
    // Umbenennen
    std::fs::write(g.join("config/neu.json"), "{\"x\": 1}").unwrap();
    assert_eq!(rename(&t.r, "config/neu.json", "Neu.json").unwrap(), "config/Neu.json");
    assert_eq!(rename(&t.r, "config/Neu.json", "b.json").unwrap(), "config/b.json");
    std::fs::write(g.join("config/c.json"), "{}").unwrap();
    assert!(rename(&t.r, "config/b.json", "c.json").is_err(), "Ziel existiert");
    assert!(rename(&t.r, "", "x").is_err(), "Wurzel");
    // Duplizieren
    assert_eq!(duplicate(&t.r, "config/b.json").unwrap(), "config/b (Kopie).json");
    assert_eq!(duplicate(&t.r, "config/b.json").unwrap(), "config/b (Kopie 2).json");
    assert_eq!(std::fs::read_to_string(g.join("config/b (Kopie).json")).unwrap(), "{\"x\": 1}");
    std::fs::write(g.join("saves/Welt/level.dat"), [1u8]).unwrap();
    assert_eq!(duplicate(&t.r, "saves/Welt").unwrap(), "saves/Welt (Kopie)");
    assert!(g.join("saves/Welt (Kopie)/level.dat").is_file());
    assert!(duplicate(&t.r, "").is_err());
    // Löschen (endgültig – der Papierkorb des Rechners bleibt in Tests unberührt)
    let out = delete(&t.r, &["config/b.json".into(), "config".into(), "config/c.json".into()], true).unwrap();
    assert_eq!(out.deleted, 1, "config enthält die anderen");
    assert!(!g.join("config").exists());
    assert!(delete(&t.r, &["".into()], true).is_err());
    assert!(delete(&t.r, &["../outside".into()], true).is_err());
    assert!(t.base.join("outside/secret.txt").is_file());
    assert!(g.exists(), "Wurzel bleibt");
}

#[test]
fn import_copies_inside() {
    let t = tmp("import");
    let g = game(&t).to_path_buf();
    let src = t.base.join("src");
    std::fs::create_dir_all(src.join("pack/sub")).unwrap();
    std::fs::write(src.join("a.json"), "{}").unwrap();
    std::fs::write(src.join("pack/sub/x.txt"), "x").unwrap();
    let s = |p: &str| src.join(p).to_string_lossy().to_string();
    let out = import(&t.r, "config", &[s("a.json"), s("pack")]).unwrap();
    assert_eq!(out, vec!["config/a.json", "config/pack"]);
    assert!(g.join("config/pack/sub/x.txt").is_file());
    // Vorhandene Namen werden nicht überschrieben
    std::fs::write(src.join("a.json"), "{\"neu\": 1}").unwrap();
    assert_eq!(import(&t.r, "config", &[s("a.json")]).unwrap(), vec!["config/a (2).json"]);
    assert_eq!(std::fs::read_to_string(g.join("config/a.json")).unwrap(), "{}");
    // Relative Quellen und fehlende Ziele
    assert!(import(&t.r, "config", &["a.json".into()]).is_err());
    assert!(import(&t.r, "fehlt", &[s("a.json")]).is_err());
    assert!(import(&t.r, "../src", &[s("a.json")]).is_err());
    // Ordner nicht in sich selbst
    let inner = g.join("config/pack").to_string_lossy().to_string();
    assert!(import(&t.r, "config/pack/sub", &[inner]).is_err());
    // In die Wurzel
    assert_eq!(import(&t.r, "", &[s("a.json")]).unwrap(), vec!["a.json"]);
}

#[test]
fn find_and_search() {
    let t = tmp("search");
    let g = game(&t);
    std::fs::write(g.join("config/a.json"), "{\n  \"RenderDistance\": 12\n}").unwrap();
    std::fs::write(g.join("config/sub/b.toml"), "renderdistance = 4\nfoo = 1\n").unwrap();
    std::fs::write(g.join("config/sub/c.bin"), "renderdistance").unwrap();
    std::fs::write(g.join("options.txt"), "renderDistance:12").unwrap();
    std::fs::write(g.join("vibe-server.json"), "renderdistance").unwrap();
    std::fs::write(g.join("big.txt"), format!("renderdistance{}", " ".repeat(SEARCH_MAX_FILE as usize))).unwrap();
    let h = search(&t.r, "RENDERdistance", None).unwrap();
    let paths: Vec<_> = h.hits.iter().map(|h| h.path.as_str()).collect();
    assert_eq!(paths, vec!["config/a.json", "config/sub/b.toml", "options.txt"]);
    assert_eq!(h.hits[0].line, 2);
    assert_eq!(h.files_skipped, 1);
    let h = search(&t.r, "renderdistance", Some("config/sub")).unwrap();
    assert_eq!(h.hits.len(), 1);
    assert!(search(&t.r, "  ", None).unwrap().hits.is_empty());
    assert!(search(&t.r, "x", Some("../")).is_err());
    let f = find(&t.r, "B.TO").unwrap();
    assert_eq!(f.entries.len(), 1);
    assert_eq!(f.entries[0].path, "config/sub/b.toml");
    assert!(find(&t.r, "vibe-server").unwrap().entries.is_empty(), "geschützt");
    assert_eq!(find(&t.r, "sub").unwrap().entries[0].kind, "dir");
}

#[test]
fn plain_paths() {
    assert_eq!(plain(Path::new(r"\\?\C:\Users\x")), Path::new(r"C:\Users\x"));
    assert_eq!(plain(Path::new(r"\\?\UNC\srv\share\x")), Path::new(r"\\srv\share\x"));
    assert_eq!(plain(Path::new("/home/x")), Path::new("/home/x"));
}
