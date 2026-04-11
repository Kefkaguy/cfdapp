import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/jobs": "http://127.0.0.1:8000",
      "/contracts": "http://127.0.0.1:8000",
      "/artifacts": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000"
    }
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts"
  }
});
