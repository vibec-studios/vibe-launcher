use super::{cleanup, store};
use std::path::Path;
use std::time::Duration;

const MIB: u64 = 1024 * 1024;
const DAY: u64 = 24 * 3600;
const LIMITS: &[(&str, u64, u64)] = &[("world-map", 1024 * MIB, 180 * DAY), ("world-preview", 256 * MIB, 180 * DAY), ("thumbs", 256 * MIB, 180 * DAY)];
const DELAY: Duration = Duration::from_secs(90);

pub fn run(data: &Path) -> u64 {
    let mut freed = cleanup::clear_tmp(data, true);
    for (name, bytes, age) in LIMITS {
        freed += cleanup::prune_dir(&data.join("cache").join(name), *bytes, Duration::from_secs(*age));
    }
    freed += store::gc(data).1;
    freed
}

pub fn on_startup(data: &Path) {
    let data = data.to_path_buf();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(DELAY).await;
        let freed = tokio::task::spawn_blocking(move || run(&data)).await.unwrap_or(0);
        if freed > 0 {
            tracing::info!("Speicher-Wartung: {} MiB freigegeben", freed / MIB);
        }
    });
}
