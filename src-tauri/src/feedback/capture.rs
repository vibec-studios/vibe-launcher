//! Screenshot des Launcher-Fensters (nur der Inhalt, ohne Rahmen) für eine Meldung.
//!
//! Windows: `PrintWindow(PW_CLIENTONLY | PW_RENDERFULLCONTENT)` – funktioniert auch für WebView2 und wenn das
//! Fenster teilweise verdeckt ist. Liefert das nur Schwarz, ersatzweise `BitBlt` vom Bildschirm.
//! Andere Systeme: nicht unterstützt (die Oberfläche bietet dann nur „Datei auswählen“).
use crate::error::{AppError, AppResult};

#[cfg(windows)]
pub fn capture_main(app: &tauri::AppHandle) -> AppResult<image::RgbaImage> {
    use tauri::Manager;
    let win = app.get_webview_window("main").ok_or_else(|| AppError::msg("Hauptfenster nicht gefunden"))?;
    let hwnd = win.hwnd().map_err(|e| AppError::msg(e.to_string()))?;
    win32::capture(hwnd.0).ok_or_else(|| AppError::msg("Der Fenster-Screenshot ist fehlgeschlagen."))
}

#[cfg(not(windows))]
pub fn capture_main(_app: &tauri::AppHandle) -> AppResult<image::RgbaImage> {
    Err(AppError::NotConfigured("Fenster-Screenshots gibt es nur unter Windows – bitte eine Datei auswählen.".into()))
}

#[cfg(windows)]
mod win32 {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows_sys::Win32::Storage::Xps::{PrintWindow, PW_CLIENTONLY};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, PW_RENDERFULLCONTENT};

    pub fn capture(hwnd: *mut core::ffi::c_void) -> Option<image::RgbaImage> {
        // SAFETY: nur GDI-Aufrufe auf dem eigenen Fenster; alle erzeugten Handles werden unten freigegeben.
        unsafe {
            let mut r: RECT = std::mem::zeroed();
            if GetClientRect(hwnd, &mut r) == 0 {
                return None;
            }
            let (w, h) = (r.right - r.left, r.bottom - r.top);
            if w <= 0 || h <= 0 || w > 16384 || h > 16384 {
                return None;
            }
            let wdc = GetDC(hwnd);
            if wdc.is_null() {
                return None;
            }
            let mdc = CreateCompatibleDC(wdc);
            let bmp = CreateCompatibleBitmap(wdc, w, h);
            let mut out = None;
            if !mdc.is_null() && !bmp.is_null() {
                let old = SelectObject(mdc, bmp);
                let printed = PrintWindow(hwnd, mdc, PW_CLIENTONLY | PW_RENDERFULLCONTENT) != 0;
                SelectObject(mdc, old);
                let mut px = read(mdc, bmp, w, h);
                if !printed || px.as_ref().map_or(true, |p| all_black(p)) {
                    let old = SelectObject(mdc, bmp);
                    BitBlt(mdc, 0, 0, w, h, wdc, 0, 0, SRCCOPY);
                    SelectObject(mdc, old);
                    px = read(mdc, bmp, w, h);
                }
                out = px.and_then(|p| image::RgbaImage::from_raw(w as u32, h as u32, p));
            }
            if !bmp.is_null() {
                DeleteObject(bmp);
            }
            if !mdc.is_null() {
                DeleteDC(mdc);
            }
            ReleaseDC(hwnd, wdc);
            out
        }
    }

    /// Pixel der (nicht ausgewählten) Bitmap als RGBA, oben links beginnend.
    unsafe fn read(dc: *mut core::ffi::c_void, bmp: *mut core::ffi::c_void, w: i32, h: i32) -> Option<Vec<u8>> {
        let mut bi: BITMAPINFO = std::mem::zeroed();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = w;
        bi.bmiHeader.biHeight = -h; // top-down
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB;
        let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
        let lines = GetDIBits(dc, bmp, 0, h as u32, buf.as_mut_ptr().cast(), &mut bi, DIB_RGB_COLORS);
        if lines != h {
            return None;
        }
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2); // BGRA -> RGBA
            px[3] = 255;
        }
        Some(buf)
    }

    fn all_black(p: &[u8]) -> bool {
        p.chunks_exact(4).step_by(97).all(|c| c[0] == 0 && c[1] == 0 && c[2] == 0)
    }
}
