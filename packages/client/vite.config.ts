import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        bridge: resolve(projectDir, "index.html"),
        planetLab: resolve(projectDir, "planet-lab.html"),
        soundLab: resolve(projectDir, "sound-lab.html")
      }
    }
  }
});
