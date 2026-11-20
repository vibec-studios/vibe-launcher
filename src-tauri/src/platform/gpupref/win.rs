use super::GpuPrefStore;
use crate::error::{AppError, AppResult};
use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteKeyValueW, RegGetValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ,
};

const KEY: &str = r"Software\Microsoft\DirectX\UserGpuPreferences";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub struct Registry;

impl GpuPrefStore for Registry {
    fn get(&self, exe: &str) -> Option<String> {
        let (k, v) = (wide(KEY), wide(exe));
        let mut buf = [0u16; 256];
        let mut len = (buf.len() * 2) as u32;
        let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), v.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) };
        if r != ERROR_SUCCESS {
            return None;
        }
        let n = (len as usize / 2).saturating_sub(1).min(buf.len());
        Some(String::from_utf16_lossy(&buf[..n]).trim_end_matches('\0').to_string())
    }

    fn set(&self, exe: &str, value: &str) -> AppResult<()> {
        let (k, v, data) = (wide(KEY), wide(exe), wide(value));
        let mut key: HKEY = std::ptr::null_mut();
        unsafe {
            let r = RegCreateKeyExW(HKEY_CURRENT_USER, k.as_ptr(), 0, std::ptr::null(), REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, std::ptr::null(), &mut key, std::ptr::null_mut());
            if r != ERROR_SUCCESS {
                return Err(AppError::msg(format!("Registry-Schlüssel nicht öffnbar ({r})")));
            }
            let r = RegSetValueExW(key, v.as_ptr(), 0, REG_SZ, data.as_ptr().cast(), (data.len() * 2) as u32);
            RegCloseKey(key);
            if r != ERROR_SUCCESS {
                return Err(AppError::msg(format!("Registry-Wert nicht schreibbar ({r})")));
            }
        }
        Ok(())
    }

    fn remove(&self, exe: &str) -> AppResult<()> {
        let (k, v) = (wide(KEY), wide(exe));
        let r = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), v.as_ptr()) };
        if r != ERROR_SUCCESS && r != ERROR_FILE_NOT_FOUND {
            return Err(AppError::msg(format!("Registry-Wert nicht löschbar ({r})")));
        }
        Ok(())
    }
}
