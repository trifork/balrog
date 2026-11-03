import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": { target: "ws://localhost:5002", ws: true },
      "/api": "http://localhost:5002",
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    restoreMocks: true,
  },
});
