import { LIMITS } from "./rules.mjs";
export class ThemeImportError extends Error {
    code;
    constructor(code){
        super(code);
        this.code = code;
    }
}
export function dataBytes(url) {
    const comma = url.indexOf(",");
    const head = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    return /;base64$/i.test(head) ? Math.floor(payload.replace(/[\s=]/g, "").length * 3 / 4) : payload.length;
}
export class Report {
    items = new Map();
    images = 0;
    fonts = 0;
    warn(code, detail) {
        const d = detail === undefined ? undefined : detail.slice(0, 80);
        const key = `${code}\u0000${d ?? ""}`;
        const cur = this.items.get(key);
        if (cur) cur.count++;
        else if (this.items.size < 200) this.items.set(key, {
            code,
            detail: d,
            count: 1
        });
    }
    list() {
        return [
            ...this.items.values()
        ];
    }
    image(url) {
        const n = dataBytes(url);
        if (n > LIMITS.imageBytes || this.images + n > LIMITS.imagesTotal) {
            this.warn("image.too_big");
            return false;
        }
        this.images += n;
        return true;
    }
    font(url) {
        const n = dataBytes(url);
        if (this.fonts + n > LIMITS.fontBytes) {
            this.warn("font.too_big");
            return false;
        }
        this.fonts += n;
        return true;
    }
}
