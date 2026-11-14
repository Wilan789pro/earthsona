import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the built `dist/` can be opened from any static host or a USB stick at the venue.
  base: "./",
  build: { chunkSizeWarningLimit: 800 }, // three.js is ~500 kB; one bundle is fine for an offline demo
  server: {
    port: 5173,
    // Luna's backend (FastAPI, backend/main.py). The browser only ever talks to /api; the Gemini key stays server-side.
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
