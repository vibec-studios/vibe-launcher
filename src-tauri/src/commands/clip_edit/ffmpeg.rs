use super::*;

pub(super) fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

pub(super) fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(exe(name))).find(|p| p.is_file())
}

pub fn find_ffmpeg(clips_dir: &Path, others: &[PathBuf]) -> Option<PathBuf> {
    let own = clips_dir.parent().map(|vc| vc.join("ffmpeg").join("bin").join(exe("ffmpeg")));
    own.into_iter()
        .chain(others.iter().map(|d| d.join("ffmpeg").join("bin").join(exe("ffmpeg"))))
        .find(|p| p.is_file())
        .or_else(|| on_path("ffmpeg"))
        .or_else(|| ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"].iter().map(PathBuf::from).find(|p| p.is_file()))
}

pub(super) fn secs(ms: i64) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}

pub(super) fn run_ffmpeg(ffmpeg: &Path, args: &[String]) -> AppResult<()> {
    let mut cmd = std::process::Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y"]).args(args).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::minecraft::java::CREATE_NO_WINDOW);
    }
    let out = cmd.output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let line = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").chars().take(200).collect::<String>();
        return Err(AppError::msg(format!("FFmpeg-Fehler: {line}")));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipExport {
    pub clip: Clip,
    pub start_ms: i64,
    pub original_deleted: bool,
}

pub fn export(dir: &Path, instance_id: &str, id: &str, range: TrimRange, ffmpeg: &Path, delete_original: bool) -> AppResult<ClipExport> {
    let orig = read_obj(dir, id)?;
    let duration = int_field(&orig, "duration_ms");
    if !valid_trim(range, duration) {
        return Err(AppError::Invalid("Ungültiger Schnittbereich".into()));
    }
    let video_name = str_field(&orig, "video").filter(|n| clips::plain_name(n)).unwrap_or_else(|| format!("{id}.mp4"));
    let src = dir.join(&video_name);
    if !src.is_file() {
        return Err(AppError::NotFound("Clip-Video".into()));
    }
    let keyframes: Vec<i64> = match parse_clip(instance_id, dir, id) {
        Parsed::Ok(c) => c.keyframes_ms,
        _ => Vec::new(),
    };
    let start = keyframe_start(&keyframes, range.in_ms);
    let end = range.out_ms;
    let new_id = new_edit_id(dir, chrono::Local::now());
    let tmp_mp4 = dir.join(format!(".{new_id}.tmp.mp4"));
    let tmp_jpg = dir.join(format!(".{new_id}.tmp.jpg"));
    let cleanup = || {
        let _ = std::fs::remove_file(&tmp_mp4);
        let _ = std::fs::remove_file(&tmp_jpg);
    };
    let args: Vec<String> = vec![
        "-ss".into(),
        secs(start),
        "-to".into(),
        secs(end),
        "-i".into(),
        src.to_string_lossy().into(),
        "-map".into(),
        "0".into(),
        "-c".into(),
        "copy".into(),
        "-avoid_negative_ts".into(),
        "make_zero".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-f".into(),
        "mp4".into(),
        tmp_mp4.to_string_lossy().into(),
    ];
    if let Err(e) = run_ffmpeg(ffmpeg, &args) {
        cleanup();
        return Err(e);
    }
    let size = std::fs::metadata(&tmp_mp4).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        cleanup();
        return Err(AppError::msg("FFmpeg hat kein Video geschrieben"));
    }
    let thumb_at = int_field(&orig, "highlight_ms").filter(|h| *h >= start && *h < end).map(|h| h - start).unwrap_or(0);
    let thumb_args: Vec<String> = vec![
        "-ss".into(),
        secs(thumb_at),
        "-i".into(),
        tmp_mp4.to_string_lossy().into(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=480:-2".into(),
        "-q:v".into(),
        "4".into(),
        "-f".into(),
        "image2".into(),
        tmp_jpg.to_string_lossy().into(),
    ];
    let has_thumb = run_ffmpeg(ffmpeg, &thumb_args).is_ok() && tmp_jpg.is_file();
    let mp4 = dir.join(format!("{new_id}.mp4"));
    let jpg = dir.join(format!("{new_id}.jpg"));
    if let Err(e) = std::fs::rename(&tmp_mp4, &mp4) {
        cleanup();
        return Err(e.into());
    }
    if has_thumb && std::fs::rename(&tmp_jpg, &jpg).is_err() {
        let _ = std::fs::remove_file(&tmp_jpg);
    }
    let meta = edited_meta(&orig, id, &new_id, start, end, size, jpg.is_file(), &chrono::Local::now().to_rfc3339());
    if let Err(e) = write_obj(dir, &new_id, meta) {
        let _ = std::fs::remove_file(&mp4);
        let _ = std::fs::remove_file(&jpg);
        return Err(e);
    }
    let clip = match parse_clip(instance_id, dir, &new_id) {
        Parsed::Ok(c) => *c,
        _ => return Err(AppError::msg("Neuer Clip nicht lesbar")),
    };
    let original_deleted = delete_original && clips::delete_clip(dir, id).is_ok();
    Ok(ClipExport { clip, start_ms: start, original_deleted })
}

pub(super) fn ffmpeg_for(state: &AppState, dir: &Path) -> Option<PathBuf> {
    let root = state.paths.instances();
    let others: Vec<PathBuf> = state
        .instances
        .list()
        .into_iter()
        .filter_map(|i| clips::clips_dir_in(&root, &i.id).ok().and_then(|d| d.parent().map(Path::to_path_buf)))
        .collect();
    find_ffmpeg(dir, &others)
}
