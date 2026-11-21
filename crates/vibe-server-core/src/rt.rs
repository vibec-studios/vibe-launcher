use std::future::Future;
use std::sync::OnceLock;
use tokio::runtime::Handle;
use tokio::task::JoinHandle;

static HANDLE: OnceLock<Handle> = OnceLock::new();

pub fn set_handle(h: Handle) {
    let _ = HANDLE.set(h);
}

pub fn spawn<F>(f: F) -> JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    match HANDLE.get() {
        Some(h) => h.spawn(f),
        None => tokio::spawn(f),
    }
}
