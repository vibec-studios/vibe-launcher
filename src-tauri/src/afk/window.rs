use std::collections::HashSet;

pub const GAME_CLASSES: &[&str] = &["GLFW30", "LWJGL", "LWJGL Display"];

#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub hwnd: isize,
    pub pid: u32,
    pub class: String,
    pub title: String,
    pub visible: bool,
    pub tool: bool,
    pub owned: bool,
}

pub fn descendants(root: u32, pairs: &[(u32, u32)]) -> HashSet<u32> {
    let mut out = HashSet::from([root]);
    loop {
        let before = out.len();
        for (pid, parent) in pairs {
            if out.contains(parent) && *pid != *parent {
                out.insert(*pid);
            }
        }
        if out.len() == before {
            return out;
        }
    }
}

pub fn pick(cands: &[Candidate], pids: &HashSet<u32>) -> Vec<isize> {
    let mine: Vec<&Candidate> = cands.iter().filter(|c| pids.contains(&c.pid) && !c.owned && !c.tool).collect();
    let known: Vec<isize> = mine.iter().filter(|c| GAME_CLASSES.contains(&c.class.as_str())).map(|c| c.hwnd).collect();
    if !known.is_empty() {
        return known;
    }
    mine.iter().filter(|c| c.visible && !c.title.trim().is_empty() && !c.class.starts_with("SunAwt") && c.class != "ConsoleWindowClass").map(|c| c.hwnd).collect()
}

pub fn game_pids(root: u32) -> HashSet<u32> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let pairs: Vec<(u32, u32)> = sys.processes().iter().filter_map(|(pid, p)| Some((pid.as_u32(), p.parent()?.as_u32()))).collect();
    descendants(root, &pairs)
}

#[cfg(windows)]
mod sys {
    use super::Candidate;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, EnumWindows, GetClassNameW, GetWindow, GetWindowLongPtrW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
        SetForegroundWindow, ShowWindow, GWL_EXSTYLE, GW_OWNER, SW_HIDE, SW_RESTORE, SW_SHOW, WS_EX_TOOLWINDOW,
    };

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> i32 {
        let out = &mut *(lparam as *mut Vec<Candidate>);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let mut class = [0u16; 128];
        let n = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32).max(0) as usize;
        let mut title = [0u16; 256];
        let t = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32).max(0) as usize;
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        out.push(Candidate {
            hwnd: hwnd as isize,
            pid,
            class: String::from_utf16_lossy(&class[..n]),
            title: String::from_utf16_lossy(&title[..t]),
            visible: IsWindowVisible(hwnd) != 0,
            tool: ex & WS_EX_TOOLWINDOW != 0,
            owned: !GetWindow(hwnd, GW_OWNER).is_null(),
        });
        1
    }

    pub fn enumerate() -> Vec<Candidate> {
        let mut out: Vec<Candidate> = Vec::new();
        unsafe {
            EnumWindows(Some(collect), &mut out as *mut Vec<Candidate> as LPARAM);
        }
        out
    }

    pub fn alive(hwnd: isize) -> bool {
        unsafe { IsWindow(hwnd as HWND) != 0 }
    }

    pub fn visible(hwnd: isize) -> bool {
        unsafe { IsWindowVisible(hwnd as HWND) != 0 }
    }

    pub fn hide(hwnd: isize) -> bool {
        unsafe {
            ShowWindow(hwnd as HWND, SW_HIDE);
            IsWindowVisible(hwnd as HWND) == 0
        }
    }

    pub fn allow_foreground(pid: u32) {
        unsafe {
            AllowSetForegroundWindow(pid);
        }
    }

    pub fn focus(hwnd: isize) {
        unsafe {
            SetForegroundWindow(hwnd as HWND);
        }
    }

    pub fn show(hwnd: isize) -> bool {
        unsafe {
            let h = hwnd as HWND;
            ShowWindow(h, SW_SHOW);
            if IsIconic(h) != 0 {
                ShowWindow(h, SW_RESTORE);
            }
            SetForegroundWindow(h);
            IsWindowVisible(h) != 0
        }
    }
}

#[cfg(not(windows))]
mod sys {
    use super::Candidate;
    pub fn enumerate() -> Vec<Candidate> {
        Vec::new()
    }
    pub fn alive(_: isize) -> bool {
        false
    }
    pub fn visible(_: isize) -> bool {
        false
    }
    pub fn hide(_: isize) -> bool {
        false
    }
    pub fn show(_: isize) -> bool {
        false
    }
    pub fn allow_foreground(_: u32) {}
    pub fn focus(_: isize) {}
}

pub use sys::{alive, allow_foreground, enumerate, focus, hide, show, visible};

pub fn find_game_windows(root: u32) -> Vec<isize> {
    let cands = enumerate();
    let direct = pick(&cands, &HashSet::from([root]));
    if !direct.is_empty() {
        return direct;
    }
    pick(&cands, &game_pids(root))
}

pub const SUPPORTED: bool = cfg!(windows);

#[cfg(test)]
mod tests {
    use super::*;

    fn c(hwnd: isize, pid: u32, class: &str, title: &str, visible: bool) -> Candidate {
        Candidate { hwnd, pid, class: class.into(), title: title.into(), visible, tool: false, owned: false }
    }

    #[test]
    fn descendants_walks_tree() {
        let pairs = [(10, 1), (11, 10), (12, 11), (20, 2), (13, 10)];
        let d = descendants(10, &pairs);
        assert_eq!(d, HashSet::from([10, 11, 12, 13]));
        assert_eq!(descendants(99, &pairs), HashSet::from([99]));
        assert_eq!(descendants(5, &[(5, 5)]), HashSet::from([5]));
    }

    #[test]
    fn pick_prefers_game_class_even_when_hidden() {
        let pids = HashSet::from([10]);
        let cands = [
            c(1, 10, "GLFW30", "Minecraft 1.21.4", false),
            c(2, 10, "IME", "Default IME", true),
            c(3, 20, "GLFW30", "Minecraft other", true),
        ];
        assert_eq!(pick(&cands, &pids), vec![1]);
    }

    #[test]
    fn pick_falls_back_to_visible_titled_windows_of_own_tree() {
        let pids = HashSet::from([10, 11]);
        let mut tool = c(4, 11, "Popup", "Tool", true);
        tool.tool = true;
        let cands = [c(1, 11, "SomeWindow", "Minecraft* 1.8.9", true), c(2, 10, "Hidden", "x", false), c(3, 10, "Blank", " ", true), tool, c(5, 30, "Other", "Fremd", true)];
        assert_eq!(pick(&cands, &pids), vec![1]);
        assert!(pick(&cands, &HashSet::from([40])).is_empty());
    }
}
