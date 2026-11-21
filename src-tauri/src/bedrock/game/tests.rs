#[test]
fn screenshots_from_session_only() {
    let tmp = super::super::tempdir("shots");
    let caps = tmp.join("Captures");
    std::fs::create_dir_all(&caps).unwrap();
    std::fs::write(caps.join("Minecraft 19.11.2026 14_03_22.png"), b"png").unwrap();
    std::fs::write(caps.join("Anderes Spiel.png"), b"png").unwrap();
    std::fs::write(caps.join("Minecraft clip.mp4"), b"mp4").unwrap();
    let now = crate::util::now_ms();
    let dest = tmp.join("shots");
    assert_eq!(super::copy_shots_from(&caps, &dest, now - 60_000, now), 1);
    assert!(dest.join("Minecraft 19.11.2026 14_03_22.png").is_file());
    assert!(caps.join("Minecraft 19.11.2026 14_03_22.png").is_file(), "Original bleibt");
    // Nicht doppelt, nicht außerhalb der Sitzung
    assert_eq!(super::copy_shots_from(&caps, &dest, now - 60_000, now), 0);
    assert_eq!(super::copy_shots_from(&caps, &tmp.join("b"), now + 3_600_000, now + 7_200_000), 0);
    let _ = std::fs::remove_dir_all(&tmp);
}
