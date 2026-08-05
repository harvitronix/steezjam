import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs so the same build works at the site root, at /play/,
  // or unzipped into an itch.io-style host.
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
});
