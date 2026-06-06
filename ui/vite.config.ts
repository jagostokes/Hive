import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api to the Hono server so the UI runs from a single origin in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      "/api": {
        target: "http://localhost:4317",
        changeOrigin: true,
      },
    },
  },
});
