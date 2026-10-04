import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3001" } }, // dev only — prod is same-origin
  build: { chunkSizeWarningLimit: 3000 },
});
