import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  // This is one static page, not an SPA. Without this, Vite answers every
  // unknown path with index.html — so /play/ quietly rendered the landing page
  // and /play/media/hero.jpg came back as HTML, which reads as a broken image
  // rather than as the 404 it actually is.
  appType: "mpa",
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
