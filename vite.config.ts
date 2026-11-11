import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the built `dist/` can be opened from any static host or a USB stick at the venue.
  base: "./",
  build: { chunkSizeWarningLimit: 800 }, // three.js is ~500 kB; one bundle is fine for an offline demo
  server: { port: 5173 },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
