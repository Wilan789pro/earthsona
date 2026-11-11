import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the built `dist/` can be opened from any static host or a USB stick at the venue.
  base: "./",
  server: { port: 5173 },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
