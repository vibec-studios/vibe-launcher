use super::Backup;
use crate::error::{AppError, AppResult};
use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegGetValueW, RegSetValueExW, HKEY, HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ,
};

const BASE: &str = r"Software\Classes\modrinth";
const BASE_TEST: &str = r"Software\VibeLauncherTest\Classes\modrinth";

fn base() -> &'static str {
    if super::test_mode() {
        BASE_TEST
    } else {
        BASE
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn get(root: HKEY, sub: &str) -> Option<String> {
    let k = wide(sub);
    let mut len: u32 = 0;
    let r = unsafe { RegGetValueW(root, k.as_ptr(), std::ptr::null(), RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), &mut len) };
    if r != ERROR_SUCCESS || len == 0 {
        return None;
    }
    let mut buf = vec![0u16; (len as usize).div_ceil(2) + 1];
    let mut len2 = (buf.len() * 2) as u32;
    let r = unsafe { RegGetValueW(root, k.as_ptr(), std::ptr::null(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len2) };
    if r != ERROR_SUCCESS {
        return None;
    }
    let n = (len2 as usize / 2).min(buf.len());
    Some(String::from_utf16_lossy(&buf[..n]).trim_end_matches('\0').to_string())
}

fn set(sub: &str, name: Option<&str>, value: &str) -> AppResult<()> {
    let k = wide(sub);
    let n = name.map(wide);
    let data = wide(value);
    let mut key: HKEY = std::ptr::null_mut();
    unsafe {
        let r = RegCreateKeyExW(HKEY_CURRENT_USER, k.as_ptr(), 0, std::ptr::null(), REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, std::ptr::null(), &mut key, std::ptr::null_mut());
        if r != ERROR_SUCCESS {
            return Err(AppError::msg(format!("Registry-Schlüssel nicht anlegbar ({r})")));
        }
        let r = RegSetValueExW(key, n.as_ref().map_or(std::ptr::null(), |n| n.as_ptr()), 0, REG_SZ, data.as_ptr().cast(), (data.len() * 2) as u32);
        RegCloseKey(key);
        if r != ERROR_SUCCESS {
            return Err(AppError::msg(format!("Registry-Wert nicht schreibbar ({r})")));
        }
    }
    Ok(())
}

pub fn current_command() -> Option<String> {
    if super::test_mode() {
        return get(HKEY_CURRENT_USER, &format!(r"{}\shell\open\command", base()));
    }
    get(HKEY_CLASSES_ROOT, r"modrinth\shell\open\command")
}

pub fn read_user() -> Option<Backup> {
    let b = base();
    let backup = Backup { default: get(HKEY_CURRENT_USER, b), icon: get(HKEY_CURRENT_USER, &format!(r"{b}\DefaultIcon")), command: get(HKEY_CURRENT_USER, &format!(r"{b}\shell\open\command")) };
    (backup != Backup::default()).then_some(backup)
}

pub fn write(exe: &str) -> AppResult<()> {
    let b = base();
    set(b, None, "URL:Modrinth")?;
    set(b, Some("URL Protocol"), "")?;
    set(&format!(r"{b}\DefaultIcon"), None, &format!("{exe},0"))?;
    set(&format!(r"{b}\shell\open\command"), None, &super::command_for(exe))
}

pub fn delete_tree() -> AppResult<()> {
    let k = wide(base());
    let r = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, k.as_ptr()) };
    if r != ERROR_SUCCESS && r != ERROR_FILE_NOT_FOUND {
        return Err(AppError::msg(format!("Registry-Schlüssel nicht löschbar ({r})")));
    }
    Ok(())
}

pub fn restore(backup: &Backup) -> AppResult<()> {
    delete_tree()?;
    let b = base();
    set(b, None, backup.default.as_deref().unwrap_or("URL:modrinth"))?;
    set(b, Some("URL Protocol"), "")?;
    if let Some(i) = &backup.icon {
        set(&format!(r"{b}\DefaultIcon"), None, i)?;
    }
    if let Some(c) = &backup.command {
        set(&format!(r"{b}\shell\open\command"), None, c)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sandbox_roundtrip() {
        assert!(super::super::test_mode());
        assert_eq!(base(), BASE_TEST);
        delete_tree().unwrap();
        assert!(current_command().is_none() && read_user().is_none());
        let other = Backup { default: Some("URL:Modrinth App".into()), icon: Some(r"C:\M\Modrinth App.exe,0".into()), command: Some(r#""C:\M\Modrinth App.exe" "%1""#.into()) };
        restore(&other).unwrap();
        assert_eq!(read_user().as_ref(), Some(&other));
        write(r"C:\V\vibe-launcher.exe").unwrap();
        assert!(super::super::evaluate(current_command().as_deref(), Some(r"C:\V\vibe-launcher.exe")).enabled);
        restore(&other).unwrap();
        assert_eq!(super::super::evaluate(current_command().as_deref(), Some(r"C:\V\vibe-launcher.exe")).other.as_deref(), Some("Modrinth App"));
        delete_tree().unwrap();
        assert!(current_command().is_none());
        let parent = wide(r"Software\VibeLauncherTest");
        unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, parent.as_ptr()) };
    }
}
