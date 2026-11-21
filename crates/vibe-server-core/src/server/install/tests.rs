use super::*;
#[test]
fn forge_launch_detection() {
    let dir = std::env::temp_dir().join(format!("vibe-forge-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let script = if cfg!(windows) { "run.bat" } else { "run.sh" };
    std::fs::write(
        dir.join(script),
        "@echo off\nREM x\njava @user_jvm_args.txt @libraries/net/neoforged/neoforge/21.1.77/win_args.txt %*\npause\n",
    )
    .unwrap();
    std::fs::write(dir.join("user_jvm_args.txt"), "# x\n").unwrap();
    assert_eq!(
        detect_forge_launch(&dir).unwrap(),
        vec!["@user_jvm_args.txt".to_string(), "@libraries/net/neoforged/neoforge/21.1.77/win_args.txt".to_string()]
    );
    std::fs::remove_file(dir.join(script)).unwrap();
    std::fs::write(dir.join("forge-1.12.2-14.23.5.2859.jar"), "x").unwrap();
    std::fs::write(dir.join("forge-1.12.2-14.23.5.2859-installer.jar"), "x").unwrap();
    assert_eq!(detect_forge_launch(&dir).unwrap(), vec!["-jar".to_string(), "forge-1.12.2-14.23.5.2859.jar".to_string()]);
    let _ = std::fs::remove_dir_all(&dir);
}
