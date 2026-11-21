use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

const MAX_CHUNK: u64 = 1024 * 1024;

#[derive(Default)]
pub struct Follow {
    pub pos: u64,
    partial: Vec<u8>,
}

impl Follow {
    pub fn at_end(path: &Path) -> Self {
        Follow { pos: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0), partial: Vec::new() }
    }

    pub fn read(&mut self, path: &Path) -> Vec<Vec<u8>> {
        let Ok(mut f) = std::fs::File::open(path) else { return Vec::new() };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        if len < self.pos {
            self.pos = 0;
            self.partial.clear();
        }
        if len == self.pos || f.seek(SeekFrom::Start(self.pos)).is_err() {
            return Vec::new();
        }
        let mut buf = Vec::new();
        let n = f.take(MAX_CHUNK).read_to_end(&mut buf).unwrap_or(0);
        self.pos += n as u64;
        self.partial.extend_from_slice(&buf[..n]);
        let mut out = Vec::new();
        while let Some(i) = self.partial.iter().position(|b| *b == b'\n') {
            out.push(self.partial.drain(..=i).collect());
        }
        out
    }

    pub fn rest(&mut self) -> Option<Vec<u8>> {
        (!self.partial.is_empty()).then(|| std::mem::take(&mut self.partial))
    }
}

pub fn follow(path: PathBuf, stop: Arc<AtomicBool>, mut on_lines: impl FnMut(Vec<Vec<u8>>) + Send + 'static) -> tokio::task::JoinHandle<()> {
    crate::rt::spawn(async move {
        let mut f = Follow::at_end(&path);
        loop {
            let done = stop.load(Ordering::Relaxed);
            let p = path.clone();
            let (back, lines) = tokio::task::spawn_blocking(move || {
                let lines = f.read(&p);
                (f, lines)
            })
            .await
            .unwrap_or_default();
            f = back;
            if !lines.is_empty() {
                on_lines(lines);
            }
            if done {
                if let Some(r) = f.rest() {
                    on_lines(vec![r]);
                }
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    })
}
