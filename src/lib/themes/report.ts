import { LIMITS } from "./rules.ts";

export type WarningCode =
  | "css.at_rule"
  | "css.selector"
  | "css.property"
  | "css.value"
  | "css.url"
  | "css.nested"
  | "css.limit"
  | "css.font"
  | "markup.element"
  | "markup.attribute"
  | "markup.url"
  | "markup.limit"
  | "markup.placeholder"
  | "slot.unknown"
  | "palette.key"
  | "palette.value"
  | "contrast.low"
  | "contrast.dropped"
  | "image.too_big"
  | "font.too_big"
  | "field.ignored";

export interface ThemeWarning {
  code: WarningCode;
  detail?: string;
  count: number;
}

export type ImportErrorCode = "empty" | "too_long" | "format" | "version" | "values";

export class ThemeImportError extends Error {
  code: ImportErrorCode;
  constructor(code: ImportErrorCode) {
    super(code);
    this.code = code;
  }
}

export function dataBytes(url: string): number {
  const comma = url.indexOf(",");
  const head = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  return /;base64$/i.test(head) ? Math.floor((payload.replace(/[\s=]/g, "").length * 3) / 4) : payload.length;
}

export class Report {
  private items = new Map<string, ThemeWarning>();
  images = 0;
  fonts = 0;

  warn(code: WarningCode, detail?: string) {
    const d = detail === undefined ? undefined : detail.slice(0, 80);
    const key = `${code}\u0000${d ?? ""}`;
    const cur = this.items.get(key);
    if (cur) cur.count++;
    else if (this.items.size < 200) this.items.set(key, { code, detail: d, count: 1 });
  }

  list(): ThemeWarning[] {
    return [...this.items.values()];
  }

  image(url: string): boolean {
    const n = dataBytes(url);
    if (n > LIMITS.imageBytes || this.images + n > LIMITS.imagesTotal) {
      this.warn("image.too_big");
      return false;
    }
    this.images += n;
    return true;
  }

  font(url: string): boolean {
    const n = dataBytes(url);
    if (this.fonts + n > LIMITS.fontBytes) {
      this.warn("font.too_big");
      return false;
    }
    this.fonts += n;
    return true;
  }
}
