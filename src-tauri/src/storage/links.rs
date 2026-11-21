use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FileId {
    pub volume: u64,
    pub index: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct LinkInfo {
    pub id: FileId,
    pub links: u32,
    pub size: u64,
}

#[cfg(windows)]
pub fn info(path: &Path) -> io::Result<LinkInfo> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    let file = std::fs::File::open(path)?;
    let mut data: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut data) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(LinkInfo {
        id: FileId { volume: data.dwVolumeSerialNumber as u64, index: ((data.nFileIndexHigh as u64) << 32) | data.nFileIndexLow as u64 },
        links: data.nNumberOfLinks,
        size: ((data.nFileSizeHigh as u64) << 32) | data.nFileSizeLow as u64,
    })
}

#[cfg(unix)]
pub fn info(path: &Path) -> io::Result<LinkInfo> {
    use std::os::unix::fs::MetadataExt;
    let m = std::fs::metadata(path)?;
    Ok(LinkInfo { id: FileId { volume: m.dev(), index: m.ino() }, links: m.nlink() as u32, size: m.len() })
}

pub fn shared(path: &Path) -> bool {
    info(path).is_ok_and(|i| i.links > 1)
}

pub fn detach(path: &Path) {
    if path.is_file() && shared(path) {
        let _ = std::fs::remove_file(path);
    }
}

fn sibling_tmp(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    target.with_file_name(format!(".{name}.{}.vlink", uuid::Uuid::new_v4().simple()))
}

pub fn replace_with_link(object: &Path, target: &Path) -> io::Result<()> {
    let tmp = sibling_tmp(target);
    std::fs::hard_link(object, &tmp)?;
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_keeps_other_links_intact() {
        let dir = super::super::test_dir("links");
        let obj = dir.join("obj");
        let a = dir.join("a.jar");
        let b = dir.join("b.jar");
        std::fs::write(&obj, b"same").unwrap();
        std::fs::write(&a, b"same").unwrap();
        std::fs::write(&b, b"same").unwrap();
        replace_with_link(&obj, &a).unwrap();
        replace_with_link(&obj, &b).unwrap();
        assert_eq!(info(&obj).unwrap().links, 3);
        assert_eq!(info(&a).unwrap().id, info(&b).unwrap().id);
        std::fs::remove_file(&a).unwrap();
        assert_eq!(std::fs::read(&b).unwrap(), b"same");
        detach(&b);
        assert!(!b.exists());
        std::fs::write(&b, b"other").unwrap();
        assert_eq!(std::fs::read(&obj).unwrap(), b"same");
        assert_eq!(info(&obj).unwrap().links, 1);
    }
}
