import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), tailwindcss()],
  define: mode === "mock" ? { "import.meta.env.VITE_MOCK": JSON.stringify("1") } : undefined,
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5190,
    strictPort: false,
    proxy: process.env.VIBE_AGENT_URL ? { "/api": { target: process.env.VIBE_AGENT_URL, ws: true, secure: false } } : undefined,
  },
  build: {
    outDir: fileURLToPath(new URL("../agent/panel-dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 900,
    assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
  },
}));
