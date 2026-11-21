import type { Handlers } from "./util";

const KEY = "vl.mock.portable";

const flag = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

let forget = false;

const status = () => ({
  active: flag(),
  root: flag() ? "E:\\Vibe\\VibeData" : "C:\\Users\\Steve\\AppData\\Roaming\\VibeLauncher",
  exe_dir: flag() ? "E:\\Vibe" : "C:\\Users\\Steve\\AppData\\Local\\Vibe Launcher",
  marker: "portable.txt",
  data_dir: "VibeData",
  forget_on_exit: flag() && forget,
  releases_url: "https://github.com/vibec-studios/vibe-launcher/releases/latest",
});

export default {
  portable_status: () => status(),
  portable_set_forget: ({ on }) => {
    forget = !!on;
    return status();
  },
  portable_forget_here: () => 1,
  portable_create_copy: ({ target }) => ({ exe: `${target}\\vibe-launcher.exe`, dir: target as string, updated: false }),
} satisfies Handlers;
