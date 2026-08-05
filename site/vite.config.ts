import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5174,
  },
  build: {
    outDir: "dist",
    // The built game is copied into dist/play by scripts/bundle-site.mjs after
    // this build runs, so emptying here is safe.
    emptyOutDir: true,
    target: "es2022",
  },
});
