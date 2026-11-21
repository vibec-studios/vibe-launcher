export const tourSelector = (id: string) => `[data-tour="${id.replace(/"/g, "")}"]`;

function visible(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

export function findTarget(targets: string[]): { el: HTMLElement; id: string } | null {
  for (const id of targets) {
    const all = document.querySelectorAll<HTMLElement>(tourSelector(id));
    for (const el of all) if (!el.closest("[data-tour-ui]") && visible(el)) return { el, id };
  }
  return null;
}

export function openDialog(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]');
  return all.length ? all[all.length - 1] : null;
}

export function hostFor(el: HTMLElement | null): HTMLElement {
  const dialog = el?.closest<HTMLElement>('[role="dialog"][data-state="open"]') ?? openDialog();
  return dialog ?? document.body;
}

export function reducedMotion(): boolean {
  return document.documentElement.dataset.reduceMotion === "true" || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

export function bringIntoView(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const tall = r.height > vh * 0.7;
  const hidden = r.bottom < 48 || r.top > vh - 48;
  const clipped = r.top < 0 || r.bottom > vh;
  if (!hidden && (tall || !clipped)) return;
  el.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
}
