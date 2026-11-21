export const FIXED_TIME = "2026-06-15T10:00:00+02:00";

export const BASE_FLAGS = {
  "vl.mock.notices": "1",
  "vl.mock.isx": "0",
  "vl.mock.latency": "1",
  "vl.mock.refresh": "1",
};

export const FREEZE_CSS = `*,*::before,*::after{animation-delay:-1ms!important;animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important;caret-color:transparent!important}`;

export function initScript({ flags, css }) {
  let seed = 0x9e3779b9;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    for (const [k, v] of Object.entries(flags)) localStorage.setItem(k, v);
  } catch {}
  const add = () => {
    const style = document.createElement("style");
    style.dataset.visual = "freeze";
    style.textContent = css;
    document.head.appendChild(style);
  };
  if (document.head) add();
  else document.addEventListener("DOMContentLoaded", add, { once: true });
}
