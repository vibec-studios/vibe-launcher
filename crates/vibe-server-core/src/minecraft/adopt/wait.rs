use std::time::Duration;

#[cfg(windows)]
fn wait_handle(pid: u32) -> Option<Option<i32>> {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, WaitForSingleObject, INFINITE, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE};
    unsafe {
        let h = OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let done = WaitForSingleObject(h, INFINITE) == WAIT_OBJECT_0;
        let mut code = 0u32;
        let ok = done && GetExitCodeProcess(h, &mut code) != 0;
        CloseHandle(h);
        Some(ok.then_some(code as i32))
    }
}

#[cfg(not(windows))]
fn wait_handle(_: u32) -> Option<Option<i32>> {
    None
}

pub async fn wait_exit(pid: u32, start_secs: u64) -> Option<i32> {
    if !super::alive(pid, start_secs) {
        return None;
    }
    if let Ok(Some(code)) = tokio::task::spawn_blocking(move || wait_handle(pid)).await {
        return code;
    }
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let gone = tokio::task::spawn_blocking(move || !super::alive(pid, start_secs)).await.unwrap_or(true);
        if gone {
            return None;
        }
    }
}
