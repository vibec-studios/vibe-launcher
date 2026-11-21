use super::*;
#[test]
fn patterns() {
    let list = re(r"There are (\d+) ?(?:of a max of|/) ?(\d+) players online:?(.*)$");
    let c = list.captures("There are 2 of a max of 20 players online: Steve, Alex").unwrap();
    assert_eq!(&c[1], "2");
    assert_eq!(&c[2], "20");
    assert_eq!(c[3].trim(), "Steve, Alex");
    let c = list.captures("There are 0/10 players online:").unwrap();
    assert_eq!(&c[2], "10");
    let join = re(r"(?:^|System chat: |\]: )([A-Za-z0-9_]{1,16}) joined the game$");
    assert_eq!(&join.captures("System chat: VibeTester joined the game").unwrap()[1], "VibeTester");
    assert_eq!(&join.captures("Steve joined the game").unwrap()[1], "Steve");
    assert!(join.captures("[Not Secure] <Bob> Alice joined the game").is_none());
    assert!(re(r#"Done \([0-9.,]+s\)! For help, type "help""#).is_match(r#"Done (3.215s)! For help, type "help""#));
}

fn plain(text: &str) -> Parsed {
    Parsed { time: None, level: LogLevel::Stdout, thread: None, logger: None, text: text.into() }
}

#[test]
fn paper_format() {
    let mut p = plain(r#"[15:42:07 INFO]: Done (6.512s)! For help, type "help""#);
    paper_line(&mut p);
    assert_eq!((p.time.as_deref(), p.level, p.logger.as_deref()), (Some("15:42:07"), LogLevel::Info, None));
    assert_eq!(p.text, r#"Done (6.512s)! For help, type "help""#);
    let mut p = plain("[15:42:01 WARN]: [LuckPerms] Could not connect");
    paper_line(&mut p);
    assert_eq!((p.level, p.logger.as_deref(), p.text.as_str()), (LogLevel::Warn, Some("LuckPerms"), "Could not connect"));
    let mut p = plain("[15:43:00 INFO]: [Not Secure] <Bob> Alice joined the game");
    paper_line(&mut p);
    assert_eq!((p.logger, p.text.as_str()), (None, "[Not Secure] <Bob> Alice joined the game"));
    let join = re(r"(?:^|System chat: |\]: )([A-Za-z0-9_]{1,16}) joined the game$");
    assert!(join.captures(&p.text).is_none());
    let mut p = plain("\x1b[33;1m[15:44:00 ERROR]: Boom\x1b[m");
    paper_line(&mut p);
    assert_eq!((p.level, p.text.as_str()), (LogLevel::Error, "Boom"));
    // Vanilla/andere Zeilen bleiben unverändert
    let mut p = plain("Starting org.bukkit.craftbukkit.Main");
    paper_line(&mut p);
    assert_eq!((p.level, p.time), (LogLevel::Stdout, None));
    // Paper-`list`-Antwort
    let list = re(r"There are (\d+) ?(?:of a max of|/|out of maximum) ?(\d+) players online\.?:?(.*)$");
    let c = list.captures("There are 1 out of maximum 20 players online.").unwrap();
    assert_eq!((&c[1], &c[2]), ("1", "20"));
}

#[test]
fn detached_server_rejects_reused_pid() {
    use crate::minecraft::adopt::ProcInfo;
    let dir = std::path::Path::new("/srv/a");
    let p = |name: &str, start: u64, cwd: Option<&str>| ProcInfo { pid: 5, start_secs: start, name: name.into(), cmd: vec![], cwd: cwd.map(Into::into) };
    assert!(super::detached::plausible(&p("java", 100, Some("/srv/a")), 100, dir));
    assert!(super::detached::plausible(&p("java.exe", 90, None), 100, dir));
    assert!(!super::detached::plausible(&p("java", 500, Some("/srv/a")), 100, dir));
    assert!(!super::detached::plausible(&p("java", 100, Some("/srv/b")), 100, dir));
    assert!(!super::detached::plausible(&p("chrome", 100, None), 100, dir));
}
