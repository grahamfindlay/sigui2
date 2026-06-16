import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite serves the frontend and proxies the data plane to the Python server.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
      "/api": { target: "http://127.0.0.1:8000" },
    },
  },
  build: { outDir: "dist" },
});
