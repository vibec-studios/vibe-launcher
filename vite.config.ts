import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

/**
 * Einstellung „Schriftgröße“ (unabhängig von der UI-Skalierung): jede feste Schriftgröße im fertigen CSS wird
 * mit `--font-scale` multipliziert (gesetzt in src/lib/appearance.ts). So wirkt sie global – auch für
 * `text-[13px]`-Utilities –, ohne dass Seiten etwas tun müssen. Abstände/Höhen bleiben unverändert.
 */
function fontScale(): Plugin {
  const scale = (n: string, unit: string) => `calc(${n}${unit} * var(--font-scale, 1))`;
  return {
    name: "vl-font-scale",
    transform(code, id) {
      if (!/\.css($|\?)/.test(id) || id.includes("?raw")) return null;
      const out = code
        // font-size: 13px  /  font-size: .75rem
        .replace(/(font-size\s*:\s*)(\d*\.?\d+)(px|rem)\b/g, (_, p: string, n: string, u: string) => p + scale(n, u))
        // font: 600 12px/1.4 …
        .replace(/(\bfont\s*:\s*(?:(?:\d{3}|bold|normal|italic)\s+)*)(\d*\.?\d+)(px)(?=[\s/])/g, (_, p: string, n: string, u: string) => p + scale(n, u))
        // Tailwind-Typo-Variablen: --text-body: 13.5px (nicht --text-body--line-height)
        .replace(/(--text-[a-z0-9]+\s*:\s*)(\d*\.?\d+)(px|rem)\b/g, (_, p: string, n: string, u: string) => p + scale(n, u));
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), fontScale()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  // Alle Abhängigkeiten beim Start vorab bündeln – kein Neuladen mitten in der Sitzung (Dev)
  optimizeDeps: { entries: ["index.html", "console.html", "src/**/*.tsx"] },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        console: fileURLToPath(new URL("./console.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
