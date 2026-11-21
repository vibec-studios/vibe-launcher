use super::*;
#[test]
fn majors() {
    assert_eq!(parse_major("1.8.0_392"), 8);
    assert_eq!(parse_major("21.0.5"), 21);
    assert_eq!(parse_major("17"), 17);
    assert_eq!(parse_major("25-ea"), 25);
}
#[test]
fn props() {
    let out = "Property settings:\n    java.vendor = Eclipse Adoptium\n    java.version = 21.0.5\n    os.arch = amd64\n\nopenjdk version \"21.0.5\"";
    let (v, vendor, arch) = parse_properties(out).unwrap();
    assert_eq!(v, "21.0.5");
    assert_eq!(vendor.as_deref(), Some("Eclipse Adoptium"));
    assert_eq!(arch, "x64");
    let (v, _, _) = parse_properties("java version \"1.8.0_51\"\nJava(TM) SE Runtime").unwrap();
    assert_eq!(v, "1.8.0_51");
}
