use super::*;
#[test]
fn log4shell_warn() {
    assert!(log4shell_warning("1.16.5", true).is_none());
    assert!(log4shell_warning("1.20.1", false).is_none());
    assert!(log4shell_warning("1.6.4", false).is_none());
    assert!(log4shell_warning("1.16.5", false).unwrap().contains("1.16.5"));
    assert!(log4shell_warning("1.8.9", false).unwrap().contains("reparieren"));
    assert!(!log4shell_warning("1.17.1", false).unwrap().contains("reparieren"));
}

#[test]
fn subst() {
    let mut v = HashMap::new();
    v.insert("a", "1".to_string());
    v.insert("classpath_separator", ";".to_string());
    assert_eq!(substitute("x${a}y", &v), "x1y");
    assert_eq!(substitute("${a}${classpath_separator}${b}", &v), "1;${b}");
    assert_eq!(substitute("${broken", &v), "${broken");
    assert_eq!(substitute("plain", &v), "plain");
}
#[test]
fn split() {
    assert_eq!(split_args(r#"-Xss2M  -Dfoo="a b" ''"#), vec!["-Xss2M", "-Dfoo=a b", ""]);
    assert!(split_args("   ").is_empty());
}
