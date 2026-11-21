const CLOCK_STEP_MS = 100;
const REAL_STEP_MS = 30;
export const TOTAL_FAKE_MS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Driver {
  constructor(page) {
    this.page = page;
    this.elapsed = 0;
    this.pending = 0;
    const done = () => {
      this.pending = Math.max(0, this.pending - 1);
    };
    page.on("request", () => this.pending++);
    page.on("requestfinished", done);
    page.on("requestfailed", done);
  }

  async quiet() {
    for (let i = 0; i < 200 && this.pending > 0; i++) await sleep(10);
    await sleep(REAL_STEP_MS);
    for (let i = 0; i < 200 && this.pending > 0; i++) await sleep(10);
  }

  async step() {
    await this.quiet();
    await this.page.clock.runFor(CLOCK_STEP_MS);
    this.elapsed += CLOCK_STEP_MS;
    await this.quiet();
  }

  async ready(locator) {
    const mocked = () => this.page.evaluate(() => typeof window.__TAURI_INTERNALS__?.invoke === "function").catch(() => false);
    for (let i = 0; i < 1200 && !(await mocked()); i++) await sleep(50);
    if (!(await mocked())) throw new Error("Mock-Backend nicht geladen");
    await this.quiet();
    await this.until(() => locator.isVisible(), String(locator), 100);
    await this.quiet();
  }

  async advance(steps) {
    for (let i = 0; i < steps; i++) await this.step();
  }

  async until(check, what, maxSteps = 60) {
    for (let i = 0; i < maxSteps; i++) {
      if (await check()) return;
      await this.step();
    }
    throw new Error(`nicht gefunden: ${what}`);
  }

  async visible(locator) {
    await this.until(() => locator.isVisible(), String(locator));
  }

  async click(locator) {
    await this.visible(locator);
    await locator.click({ force: true, timeout: 5000 });
    await this.step();
  }

  button(name) {
    return this.page.getByRole("button", { name, exact: true }).first();
  }

  menuItem(name) {
    return this.page.getByRole("menuitem", { name, exact: true }).first();
  }

  async dialog() {
    await this.visible(this.page.getByRole("dialog").first());
  }

  async settle() {
    await this.advance(20);
    await this.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await this.page.evaluate(() => document.fonts.ready.then(() => undefined));
  }

  async finish() {
    while (this.elapsed < TOTAL_FAKE_MS) await this.step();
    await this.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    return this.elapsed === TOTAL_FAKE_MS;
  }
}
